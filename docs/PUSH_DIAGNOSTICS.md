# Push diagnostics

Each send is recorded in `push_delivery_attempts` before contacting the push provider. The row identifies the salon, appointment, template, subscription ID, user ID, endpoint SHA-256 and provider hostname; it never copies subscription keys or the raw endpoint. Attempted/finished times, duration, HTTP status and bounded error codes distinguish configuration failure, missing targets, expired subscriptions, rejected requests and network/timeouts. Delivery still proceeds if diagnostics storage fails; that failure goes to the existing platform error log.

`push_delivery_events` stores each browser report with a unique event ID, the device-reported clock time and the server recording time. Events: received, show_resolved, show_failed, clicked, closed, click_opened, click_failed, payload_invalid. Worker version, permission, browser user agent, connectivity hint, action and error name provide context. Notification payloads contain only a per-message receipt capability; the database stores its SHA-256. The receipt endpoint needs no login, so reports work in a background service worker. It cannot read or change appointments. The server-only ingestion function validates the capability, derives tenant from the attempt, deduplicates event IDs, locks per attempt and bounds storage to 64 events.

Receipts use a separate IndexedDB outbox, not the calendar cache. Failed network reports remain queued and retry on push, activation, supported background sync, app opening, connectivity restoration or returning to the app. Display and click navigation start independently of telemetry. If storage itself is unavailable, immediate reporting is attempted; completeness is then not guaranteed.

`push_client_events` records notification-control clicks, test results, permission results, subscription failures and browser/worker checks. These require an authenticated salon membership, are bounded and rate limited; this is not general click tracking.

Query `push_delivery_diagnostics` for a summary, then `push_delivery_events` for every individual interaction. Member reads are isolated by salon; only the server writes. No automatic retention job deletes these temporary diagnostic records. Tenant deletion cascades as with other salon data.

Semantics:
- accepted = provider accepted the request, not device delivery.
- worker_received = the worker reported receiving the payload.
- show_call_resolved = showNotification completed; this is NOT proof of a visible banner, sound, or human attention.
- click_confirmed = a click report was received, not proof that text was read.
- receipt_unconfirmed = unknown. It MUST NOT be relabeled undelivered or not clicked.
- closed is browser-reported dismissal where supported; its absence proves nothing.
- device clock timestamps can be wrong; use recorded_at for trustworthy ingestion order and do not interpret delayed receipt uploads as device delivery delay.
- no retrospective delivery/interaction evidence exists for pushes sent before this release.
- storage/network/browser termination, removed permissions or system policies can prevent reports. Web Push cannot reliably expose the system's precise Doze/Focus/notification-channel decisions.

A fresh worker requires opening the app once after deployment. Old workers can receive messages without returning the new receipts.

Example (read only):
```sql
select attempted_at at time zone 'Europe/Belgrade', template, subscription_id,
       send_status, http_status, error_code, device_status,
       device_received_at, received_reported_at, clicked_reported_at
from public.push_delivery_diagnostics
where tenant_id = :tenant_id order by attempted_at desc;
```
