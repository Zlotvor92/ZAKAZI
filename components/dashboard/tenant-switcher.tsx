"use client";

import { useTransition } from "react";
import type { TenantSummary } from "@/lib/db/tenants";
import { sr } from "@/lib/i18n/sr";

/**
 * Prebacivanje između salona. Domaći `select` namerno: na telefonu ga sistem
 * otvori kao točkić preko celog ekrana, što nijedna naša lista ne dostiže.
 */
export function TenantSwitcher({
  tenants,
  selected,
  onSwitch,
}: {
  tenants: TenantSummary[];
  selected: string;
  onSwitch: (tenantId: string) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      aria-label={sr.tenants.switchLabel}
      value={selected}
      disabled={pending}
      onChange={(event) => {
        const next = event.target.value;
        startTransition(async () => {
          await onSwitch(next);
        });
      }}
      className="border-border h-9 max-w-40 truncate rounded-md border bg-transparent px-2 text-sm"
    >
      {tenants.map((tenant) => (
        <option key={tenant.id} value={tenant.id}>
          {tenant.name}
        </option>
      ))}
    </select>
  );
}
