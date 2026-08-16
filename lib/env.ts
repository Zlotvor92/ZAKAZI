export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Nedostaje promenljiva okruženja ${name}. ` +
        "Dodaj je u podešavanja projekta i napravi novu verziju — " +
        "NEXT_PUBLIC_ promenljive se ugrađuju u toku build-a.",
    );
  }
  return value;
}
