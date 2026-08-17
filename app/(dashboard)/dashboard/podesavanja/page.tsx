import { headers } from "next/headers";
import Link from "next/link";
import { getBlockedNumbers } from "@/lib/db/blocklist";
import { getCurrentTenant } from "@/lib/db/tenants";
import { getWorkingHours } from "@/lib/db/working-hours";
import { toDayShapes } from "@/lib/domain/working-hours";
import { sr } from "@/lib/i18n/sr";
import {
  BlockedNumbers,
  BookingRulesForm,
  WorkingHoursForm,
} from "./settings-forms";

async function publicUrl(slug: string): Promise<string> {
  const incoming = await headers();
  const host = incoming.get("host") ?? "";
  const protocol = incoming.get("x-forwarded-proto") ?? "https";

  return `${protocol}://${host}/${slug}`;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-border border-t py-5">
      <h2 className="pb-3 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function SettingsPage() {
  const tenant = await getCurrentTenant();

  if (!tenant) {
    return (
      <main className="mx-auto min-h-dvh w-full max-w-md p-4">
        <p className="text-muted-foreground py-8 text-sm">
          {sr.dashboard.noTenant}
        </p>
      </main>
    );
  }

  const [workingHours, blocked, link] = await Promise.all([
    getWorkingHours(),
    getBlockedNumbers(),
    publicUrl(tenant.slug),
  ]);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md p-4">
      <header className="pb-2">
        <Link href="/dashboard" className="text-muted-foreground text-sm">
          ‹ {sr.settings.back}
        </Link>
        <h1 className="pt-2 text-lg font-semibold tracking-tight">
          {sr.settings.title}
        </h1>
      </header>

      <Section title={sr.settings.linkTitle}>
        <p className="bg-accent rounded-md p-3 text-sm break-all">{link}</p>
        <p className="text-muted-foreground pt-2 text-xs">
          {sr.settings.linkHint}
        </p>
      </Section>

      <Section title={sr.settings.hoursTitle}>
        <WorkingHoursForm week={toDayShapes(workingHours)} />
      </Section>

      <Section title={sr.settings.rulesTitle}>
        <BookingRulesForm
          horizonDays={tenant.booking_horizon_days}
          leadHours={Math.round(tenant.min_lead_minutes / 60)}
          publicEnabled={tenant.public_booking_enabled}
        />
      </Section>

      <Section title={sr.settings.blockedTitle}>
        <BlockedNumbers numbers={blocked} />
      </Section>
    </main>
  );
}
