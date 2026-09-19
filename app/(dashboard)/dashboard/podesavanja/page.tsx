import {
  Ban,
  Bell,
  CalendarDays,
  CalendarOff,
  ChevronLeft,
  Scissors,
  Clock,
  SlidersHorizontal,
} from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { display } from "@/app/fonts";
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
  CalendarFeed,
  PublicLink,
  ServicesSection,
  TimeOffSection,
  WorkingHoursForm,
} from "./settings-forms";
import { disableNotifications, enableNotifications } from "./actions";

async function siteOrigin(): Promise<string> {
  const incoming = await headers();
  const host = incoming.get("host") ?? "";
  const protocol = incoming.get("x-forwarded-proto") ?? "https";

  return `${protocol}://${host}`;
}

async function publicUrl(slug: string): Promise<string> {
  return `${await siteOrigin()}/${slug}`;
}

/**
 * Sekcija je bela kartica na papiru, sa krugom i znakom levo od naslova.
 *
 * Forme unutra ostaju gde su bile — podešavanja su jedna strana, ne spisak
 * pod-strana. Krug nosi znak da bi se sekcija našla prstom, bez čitanja svih
 * naslova od početka.
 */
function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[22px] border border-[#E4DAC9] bg-white p-4">
      <div className="flex items-center gap-3 pb-3">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-full bg-[#FBF7F0] text-[#8C1D3F]"
        >
          {icon}
        </span>
        <h2 className={`${display.className} min-w-0 text-[19px]`}>{title}</h2>
      </div>
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
      <div className="min-h-dvh bg-[#FBF7F0] text-[#211D1A]">
        <main className="mx-auto w-full max-w-md p-4">
          <p className="py-8 text-sm text-[#554C44]">{sr.dashboard.noTenant}</p>
          <Link
            href="/dashboard"
            className="inline-flex min-h-11 items-center text-sm text-[#8C1D3F] underline"
          >
            {sr.settings.back}
          </Link>
        </main>
      </div>
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
    <div className="min-h-dvh bg-[#FBF7F0] text-[#211D1A]">
      <main className="mx-auto w-full max-w-md space-y-3 px-4 pb-8">
        <header className="flex h-[60px] items-center gap-3">
          <Link
            href="/dashboard"
            aria-label={sr.settings.back}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-white transition-colors hover:bg-[#E4DAC9]"
          >
            <ChevronLeft size={19} strokeWidth={2} aria-hidden />
          </Link>
          <h1 className={`${display.className} text-[19px]`}>
            {sr.settings.title}
          </h1>
        </header>

        {/* Link je jedina stvar sa ove strane koja stalno treba drugde, pa
            stoji izdvojeno i u boji, iznad svega ostalog. */}
        <PublicLink url={link} />

        <Section
          title={sr.settings.servicesTitle}
          icon={<Scissors size={18} strokeWidth={1.8} />}
        >
          <ServicesSection services={services} />
        </Section>

        <Section
          title={sr.settings.hoursTitle}
          icon={<Clock size={18} strokeWidth={1.8} />}
        >
          <WorkingHoursForm week={toDayShapes(blocks)} />
        </Section>

        <Section
          title={sr.settings.rulesTitle}
          icon={<SlidersHorizontal size={18} strokeWidth={1.8} />}
        >
          <BookingRulesForm
            horizonDays={tenant.booking_horizon_days}
            leadHours={Math.round(tenant.min_lead_minutes / 60)}
            publicEnabled={tenant.public_booking_enabled}
            breakOverrunMin={tenant.break_overrun_min}
            shiftOverrunMin={tenant.shift_overrun_min}
          />
        </Section>

        <Section
          title={sr.settings.timeOffTitle}
          icon={<CalendarOff size={18} strokeWidth={1.8} />}
        >
          <TimeOffSection
            entries={timeOff}
            timeZone={tenant.timezone}
            today={currentDateInTimeZone(new Date(), tenant.timezone)}
          />
        </Section>

        <Section
          title={sr.settings.pushTitle}
          icon={<Bell size={18} strokeWidth={1.8} />}
        >
          <p className="pb-3 text-sm text-[#554C44]">{sr.settings.pushHint}</p>
          {vapidPublicKey === "" ? (
            <p className="text-sm text-[#554C44]">
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

        <Section
          title={sr.settings.calendarTitle}
          icon={<CalendarDays size={18} strokeWidth={1.8} />}
        >
          <CalendarFeed
            token={tenant.calendar_token}
            origin={await siteOrigin()}
          />
        </Section>

        <Section
          title={sr.settings.blockedTitle}
          icon={<Ban size={18} strokeWidth={1.8} />}
        >
          <BlockedNumbers numbers={blocked} />
        </Section>
      </main>
    </div>
  );
}
