import Link from "next/link";
import { getActiveServices } from "@/lib/db/services";
import { getCurrentTenant } from "@/lib/db/tenants";
import { currentDateInTimeZone } from "@/lib/domain/calendar";
import { sr } from "@/lib/i18n/sr";
import { selectedTenantId } from "@/lib/tenant";
import { AppointmentForm } from "./appointment-form";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type PageProps = { searchParams: Promise<{ dan?: string }> };

export default async function NewAppointmentPage({ searchParams }: PageProps) {
  const tenant = await getCurrentTenant(await selectedTenantId());

  if (!tenant) {
    // Isto kao u podešavanjima: izbor salona koji više ne važi ne sme da
    // ostavi stranu bez ijednog puta dalje.
    return (
      <main className="mx-auto min-h-dvh w-full max-w-md p-4">
        <p className="text-muted-foreground py-8 text-sm">
          {sr.dashboard.noTenant}
        </p>
        <Link
          href="/dashboard"
          className="text-brand inline-flex min-h-11 items-center text-sm underline"
        >
          ‹ {sr.newAppointment.back}
        </Link>
      </main>
    );
  }

  const services = await getActiveServices(tenant.id);

  // Predlaže se trajanje prve usluge; vlasnica ga svejedno menja kako hoće.
  const defaultDuration = services[0]?.duration_min ?? 60;
  const requested = (await searchParams).dan;
  const date =
    requested && DATE_PATTERN.test(requested)
      ? requested
      : currentDateInTimeZone(new Date(), tenant.timezone);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md p-4">
      <header className="pb-4">
        <Link
          href={`/dashboard?dan=${date}`}
          className="text-muted-foreground inline-flex min-h-11 items-center text-sm"
        >
          ‹ {sr.newAppointment.back}
        </Link>
        <h1 className="pt-2 text-lg font-semibold tracking-tight">
          {sr.newAppointment.title}
        </h1>
      </header>

      {services.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {sr.newAppointment.noServices}
        </p>
      ) : (
        <AppointmentForm
          services={services}
          date={date}
          defaultDuration={defaultDuration}
        />
      )}
    </main>
  );
}
