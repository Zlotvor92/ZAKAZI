"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { sr } from "@/lib/i18n/sr";
import type { PushSubscriptionInput } from "@/lib/db/push";

type State = "checking" | "off" | "on" | "blocked" | "unsupported";

/** VAPID ključ putuje kao base64url, a `subscribe` traži sirove bajtove. */
function decodeKey(base64Url: string): ArrayBuffer {
  const padded = (base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);

  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }

  return buffer;
}

function toInput(subscription: PushSubscription): PushSubscriptionInput | null {
  const json = subscription.toJSON();

  if (!json.endpoint || !json.keys?.["p256dh"] || !json.keys["auth"]) {
    return null;
  }

  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys["p256dh"], auth: json.keys["auth"] },
  };
}

export function PushToggle({
  publicKey,
  onEnable,
  onDisable,
}: {
  publicKey: string;
  onEnable: (subscription: PushSubscriptionInput) => Promise<boolean>;
  onDisable: (endpoint: string) => Promise<void>;
}) {
  const [state, setState] = useState<State>("checking");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setState("unsupported");
      return;
    }

    if (Notification.permission === "denied") {
      setState("blocked");
      return;
    }

    navigator.serviceWorker
      .getRegistration()
      .then((registration) => registration?.pushManager.getSubscription())
      .then((subscription) => setState(subscription ? "on" : "off"))
      .catch(() => setState("off"));
  }, []);

  function enable() {
    setMessage(null);
    startTransition(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setState(permission === "denied" ? "blocked" : "off");
          return;
        }

        const registration = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;

        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeKey(publicKey),
        });

        const input = toInput(subscription);
        if (!input || !(await onEnable(input))) {
          setMessage(sr.settings.pushFailed);
          return;
        }

        setState("on");
      } catch {
        setMessage(sr.settings.pushFailed);
      }
    });
  }

  function disable() {
    startTransition(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();

      if (subscription) {
        await onDisable(subscription.endpoint);
        await subscription.unsubscribe();
      }

      setState("off");
    });
  }

  if (state === "checking") {
    return null;
  }

  if (state === "unsupported") {
    return (
      <p className="text-muted-foreground text-sm">
        {sr.settings.pushUnsupported}
      </p>
    );
  }

  if (state === "blocked") {
    return (
      <p role="alert" className="text-destructive text-sm">
        {sr.settings.pushBlocked}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm">
        {state === "on" ? sr.settings.pushOn : sr.settings.pushOff}
      </p>

      {state === "on" ? (
        <Button type="button" variant="outline" onClick={disable} disabled={pending}>
          {sr.settings.pushDisable}
        </Button>
      ) : (
        <Button type="button" className="h-12 w-full" onClick={enable} disabled={pending}>
          {pending ? sr.settings.pushEnabling : sr.settings.pushEnable}
        </Button>
      )}

      {message ? (
        <p role="alert" className="text-destructive text-sm">
          {message}
        </p>
      ) : null}

      <p className="text-muted-foreground text-xs">{sr.settings.pushIosHint}</p>
    </div>
  );
}
