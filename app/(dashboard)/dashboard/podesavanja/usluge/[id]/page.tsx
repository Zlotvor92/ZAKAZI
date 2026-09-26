import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { display } from "@/app/fonts";
import { getActiveServices } from "@/lib/db/services";
import { getCurrentTenant } from "@/lib/db/tenants";
import { sr } from "@/lib/i18n/sr";
import { selectedTenantId } from "@/lib/tenant";
import { LIST_HREF, NEW_SERVICE_ID } from "./paths";
import { ServiceEditor } from "./service-editor";

type PageProps = { params: Promise<{ id: string }> };

function Missing({ message }: { message: string }) {
  return (
    <div className="min-h-dvh bg-[#FBF7F0] text-[#211D1A]">
      <main className="mx-auto w-full max-w-md p-4">
        <p className="py-8 text-sm text-[#554C44]">{message}</p>
        <Link
          href={LIST_HREF}
          className="inline-flex min-h-11 items-center text-sm text-[#8C1D3F] underline"
        >
          {sr.settings.serviceBackToList}
        </Link>
      </main>
    </div>
  );
}

export default async function ServicePage({ params }: PageProps) {
  const { id } = await params;
  const tenant = await getCurrentTenant(await selectedTenantId());

  if (!tenant) {
    return <Missing message={sr.dashboard.noTenant} />;
  }

  const services = await getActiveServices(tenant.id);
  const isNew = id === NEW_SERVICE_ID;
  const service = isNew ? null : services.find((other) => other.id === id);

  // Uklonjena usluga, ili link iz drugog salona: sve RLS-om ionako ne stiže.
  if (!isNew && !service) {
    return <Missing message={sr.settings.serviceMissing} />;
  }

  return (
    <div className="min-h-dvh bg-[#FBF7F0] text-[#211D1A]">
      <main className="mx-auto w-full max-w-md space-y-3 px-4 pb-8">
        <header className="flex h-[60px] items-center gap-3">
          <Link
            href={LIST_HREF}
            aria-label={sr.settings.serviceBackToList}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-white transition-colors hover:bg-[#E4DAC9]"
          >
            <ChevronLeft size={19} strokeWidth={2} aria-hidden />
          </Link>
          <h1 className={`${display.className} min-w-0 truncate text-[19px]`}>
            {service?.name ?? sr.settings.serviceNewTitle}
          </h1>
        </header>

        <ServiceEditor
          service={service ?? null}
          others={services.filter((other) => other.id !== id)}
        />
      </main>
    </div>
  );
}
