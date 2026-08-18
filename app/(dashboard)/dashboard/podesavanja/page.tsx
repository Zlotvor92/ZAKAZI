import { headers } from "next/headers";
import Link from "next/link";
import { PushToggle } from "@/components/dashboard/push-toggle";
import { getBlockedNumbers } from "@/lib/db/blocklist";
import { getActiveServices } from "@/lib/db/services";
import { getCurrentTenant } from "@/lib/db/tenants";
import { getUpcomingTimeOff } from "@/lib/db/time-off";
import { getWorkingBlocks } from "@/lib/db/working-hours";
import { currentDateInTimeZone } from "@/lib/domain/calendar";
import { toDayShapes } from "@/lib/domain/working-hours";
import { sr } from "@/lib/i18n/sr";
import { selectedTenantId } from "@/lib/tenant";
import {
  BlockedNumbers,
  BookingRulesForm,
  ServicesSection,
  TimeOffSection,
  WorkingHoursForm,
} from "./settings-forms";
import { disableNotifications, enableNotifications } from "./actions";

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
  const tenant = await getCurrentTenant(await selectedTenantId());

  if (!tenant) {
    // Ovde se stiže i sa izborom salona koji više ne važi. Bez puta nazad
    // strana je ćorsokak: kalendar bar nudi izbor salona, a ovde ga nema.
    return (
      <main className="mx-auto min-h-dvh w-full max-w-md p-4">
        <p className="text-muted-foreground py-8 text-sm">
          {sr.dashboard.noTenant}
        </p>
        <Link
          href="/dashboard"
          className="text-brand inline-flex min-h-11 items-center text-sm underline"
        >
          ‹ {sr.settings.back}
        </Link>
      </main>
    );
  }

  // Ostalo zavisi samo od salona, pa ide odjednom umesto u redu.
  const [blocks, services, timeOff, blocked] = await Promise.all([
    getWorkingBlocks(tenant.id),
    getActiveServices(tenant.id),
    getUpcomingTimeOff(tenant.id),
    getBlockedNumbers(tenant.id),
  ]);

  const link = await publicUrl(tenant.slug);
  // Javni deo VAPID para; bez njega pregledač ne ume da se pretplati, a strana
  // ne sme da padne samo zato što obaveštenja još nisu podešena.
  const vapidPublicKey = process.env["NEXT_PUBLIC_VAPID_PUBLIC_KEY"] ?? "";

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md p-4">
      <header className="pb-2">
        <Link
          href="/dashboard"
          className="text-muted-foreground inline-flex min-h-11 items-center text-sm"
        >
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

      <Section title={sr.settings.servicesTitle}>
        <ServicesSection services={services} />
      </Section>

      <Section title={sr.settings.hoursTitle}>
        <WorkingHoursForm week={toDayShapes(blocks)} />
      </Section>

      <Section title={sr.settings.rulesTitle}>
        <BookingRulesForm
          horizonDays={tenant.booking_horizon_days}
          leadHours={Math.round(tenant.min_lead_minutes / 60)}
          publicEnabled={tenant.public_booking_enabled}
        />
      </Section>

      <Section title={sr.settings.timeOffTitle}>
        <TimeOffSection
          entries={timeOff}
          timeZone={tenant.timezone}
          today={currentDateInTimeZone(new Date(), tenant.timezone)}
        />
      </Section>

      <Section title={sr.settings.pushTitle}>
        <p className="text-muted-foreground pb-3 text-sm">
          {sr.settings.pushHint}
        </p>
        {vapidPublicKey === "" ? (
          <p className="text-muted-foreground text-sm">
            {sr.settings.pushUnsupported}
          </p>
        ) : (
          <PushToggle
            publicKey={vapidPublicKey}
            onEnable={enableNotifications}
            onDisable={disableNotifications}
          />
        )}
      </Section>

      <Section title={sr.settings.blockedTitle}>
        <BlockedNumbers numbers={blocked} />
      </Section>
    </main>
  );
}
