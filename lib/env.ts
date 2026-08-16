export function requireEnv(name: string): string {
  // Vrednost nalepljena u podešavanja lako ponese razmak ili prelom reda, a
  // takva greška je nevidljiva u interfejsu.
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Nedostaje promenljiva okruženja ${name}. ` +
        "Dodaj je u podešavanja projekta i napravi novu verziju — " +
        "NEXT_PUBLIC_ promenljive se ugrađuju u toku build-a.",
    );
  }
  return value;
}

export function requireUrlEnv(name: string): string {
  const value = requireEnv(name);

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `Promenljiva ${name} nije ispravan URL. Dobijeno: ${value} — ` +
        "očekuje se oblik https://abcdefgh.supabase.co (Supabase → " +
        "Project Settings → API → Project URL).",
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      `Promenljiva ${name} mora počinjati sa https://. Dobijeno: ${value}`,
    );
  }

  return value;
}
