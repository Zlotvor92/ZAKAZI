import Link from "next/link";
import { notFound } from "next/navigation";
import { getLastBackupRun } from "@/lib/backup/status";
import { getAdminSalons, isPlatformOwner } from "@/lib/db/admin";
import { backupState, hoursSince } from "@/lib/domain/backup-health";
import { currentDateInTimeZone } from "@/lib/domain/calendar";
import { sr } from "@/lib/i18n/sr";
import { BackupBanner } from "./backup-banner";
import { NewSalonForm } from "./new-salon-form";
import { SalonList } from "./salon-list";

export default async function AdminPage() {
  // Konzola postoji samo za vlasnika platforme. Ko to nije, ne dobija poruku
  // da mu je zabranjeno nego da stranice nema — nema šta da sazna da postoji.
  if (!(await isPlatformOwner())) {
    notFound();
  }

  const salons = await getAdminSalons();

  // Kopija baze nema gde drugde da se javi: posao je na GitHub-u, a jedini ko
  // treba da zna da je stao je onaj ko ovu stranu i otvara.
  const now = new Date();
  const lastRun = await getLastBackupRun();

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl p-4">
      <header className="flex items-center justify-between gap-4 pb-4">
        <h1 className="text-lg font-semibold tracking-tight">
          {sr.admin.title}
        </h1>
        <Link
          href="/dashboard"
          className="text-muted-foreground inline-flex min-h-11 items-center text-sm"
        >
          {sr.admin.back} ›
        </Link>
      </header>

      <BackupBanner
        state={backupState(lastRun, now)}
        hours={lastRun === null ? null : hoursSince(lastRun, now)}
      />

      <div className="pb-5">
        <NewSalonForm />
      </div>

      {/* Svi saloni su u Srbiji, pa konzola meri dan po Beogradu — ne po
          tajmzoni pojedinačnog salona. */}
      <SalonList
        salons={salons}
        today={currentDateInTimeZone(new Date(), "Europe/Belgrade")}
      />
    </main>
  );
}
