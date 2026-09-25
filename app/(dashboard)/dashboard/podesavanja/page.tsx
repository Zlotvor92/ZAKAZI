import {
  Ban,
  Bell,
  CalendarDays,
  CalendarOff,
  ChevronDown,
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
import { pluralize } from "@/lib/domain/plural";
import { describeWeek, toDayShapes } from "@/lib/domain/working-hours";
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
 * Sekcija je bela kartica koja se otvara dodirom.
 *
 * Zatvorena pokazuje sažetak — koliko usluga, kad radiš — pa se cela strana
 * vidi bez skrolovanja, a forma se otvara tek kad treba nešto promeniti.
 * `<details>` radi i bez JavaScript-a, a čitač ekrana zna da je rasklopivo.
 */
function Section({
  title,
  summary,
  icon,
  children,
}: {
  title: string;
  summary: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-[20px] border border-[#E4DAC9] bg-white">
      <summary className="flex min-h-[64px] cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="shrink-0 text-[#8C1D3F]">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{title}</span>
          <span className="block truncate pt-0.5 text-[13px] text-[#6B6055]">
            {summary}
          </span>
        </span>
        <ChevronDown
          size={19}
          strokeWidth={1.8}
          aria-hidden
          className="shrink-0 text-[#9A8F80] transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-[#EFE7DA] px-4 pt-3 pb-4">{children}</div>
    </details>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-1 pt-3 text-[11px] font-bold tracking-[0.14em] text-[#6B6055] uppercase">
      {children}
    </h2>
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
  const week = toDayShapes(blocks);
  const leadHours = Math.round(tenant.min_lead_minutes / 60);
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

        <GroupLabel>{sr.settings.groupSalon}</GroupLabel>

        <Section
          title={sr.settings.servicesTitle}
          summary={`${services.length} ${pluralize(services.length, sr.admin.servicesCount)}`}
          icon={<Scissors size={19} strokeWidth={1.8} />}
        >
          <ServicesSection services={services} />
        </Section>

        <Section
          title={sr.settings.hoursTitle}
          summary={
            describeWeek(week, sr.settings.weekdaysShort) ?? sr.settings.hoursNone
          }
          icon={<Clock size={19} strokeWidth={1.8} />}
        >
          <WorkingHoursForm week={week} />
        </Section>

        <GroupLabel>{sr.settings.groupBooking}</GroupLabel>

        <Section
          title={sr.settings.rulesTitle}
          summary={
            tenant.public_booking_enabled
              ? sr.settings.rulesSummary
                  .replace("{dana}", String(tenant.booking_horizon_days))
                  .replace("{sati}", String(leadHours))
              : sr.settings.rulesClosed
          }
          icon={<SlidersHorizontal size={19} strokeWidth={1.8} />}
        >
          <BookingRulesForm
            horizonDays={tenant.booking_horizon_days}
            leadHours={leadHours}
            publicEnabled={tenant.public_booking_enabled}
            breakOverrunMin={tenant.break_overrun_min}
            shiftOverrunMin={tenant.shift_overrun_min}
          />
        </Section>

        <Section
          title={sr.settings.timeOffTitle}
          summary={
            timeOff.length === 0
              ? sr.settings.timeOffNone
              : `${timeOff.length} ${pluralize(timeOff.length, sr.settings.timeOffCount)}`
          }
          icon={<CalendarOff size={19} strokeWidth={1.8} />}
        >
          <TimeOffSection
            entries={timeOff}
            timeZone={tenant.timezone}
            today={currentDateInTimeZone(new Date(), tenant.timezone)}
          />
        </Section>

        <Section
          title={sr.settings.blockedTitle}
          summary={
            blocked.length === 0
              ? sr.settings.blockedNone
              : `${blocked.length} ${pluralize(blocked.length, sr.settings.blockedCount)}`
          }
          icon={<Ban size={19} strokeWidth={1.8} />}
        >
          <BlockedNumbers numbers={blocked} />
        </Section>

        <GroupLabel>{sr.settings.groupNotifications}</GroupLabel>

        <Section
          title={sr.settings.pushTitle}
          summary={sr.settings.pushSummary}
          icon={<Bell size={19} strokeWidth={1.8} />}
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
          summary={
            tenant.calendar_token
              ? sr.settings.calendarOn
              : sr.settings.calendarOff
          }
          icon={<CalendarDays size={19} strokeWidth={1.8} />}
        >
          <CalendarFeed
            token={tenant.calendar_token}
            origin={await siteOrigin()}
          />
        </Section>
      </main>
    </div>
  );
}
