import Link from "next/link";
import { sr } from "@/lib/i18n/sr";
import { NewTenantForm } from "./new-tenant-form";

export default function NewTenantPage() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-md p-4">
      <header className="pb-4">
        <Link href="/dashboard" className="text-muted-foreground text-sm">
          ‹ {sr.settings.back}
        </Link>
        <h1 className="pt-2 text-lg font-semibold tracking-tight">
          {sr.tenants.create}
        </h1>
        <p className="text-muted-foreground pt-1 text-sm">{sr.tenants.hint}</p>
      </header>

      <NewTenantForm />
    </main>
  );
}
