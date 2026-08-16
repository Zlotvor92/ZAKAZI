import { Button } from "@/components/ui/button";
import { getCurrentTenant } from "@/lib/db/tenants";
import { sr } from "@/lib/i18n/sr";
import { signOut } from "./actions";

export default async function DashboardPage() {
  const tenant = await getCurrentTenant();

  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl p-4">
      <header className="flex items-center justify-between gap-4 py-2">
        <h1 className="truncate text-lg font-semibold tracking-tight">
          {tenant?.name ?? sr.app.name}
        </h1>
        <form action={signOut}>
          <Button type="submit" variant="outline" size="sm">
            {sr.dashboard.signOut}
          </Button>
        </form>
      </header>

      {tenant ? null : (
        <p className="text-muted-foreground py-8 text-sm">
          {sr.dashboard.noTenant}
        </p>
      )}
    </main>
  );
}
