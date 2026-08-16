import { sr } from "@/lib/i18n/sr";

export default function HomePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{sr.app.name}</h1>
      <p className="text-muted-foreground text-sm">{sr.app.description}</p>
    </main>
  );
}
