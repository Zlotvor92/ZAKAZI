export type Brand = {
  background: string | null;
  primary: string | null;
  accent: string | null;
};

const HEX = /^#[0-9a-f]{6}$/;

function clean(value: string | null): string | null {
  const lowered = value?.trim().toLowerCase() ?? "";
  return HEX.test(lowered) ? lowered : null;
}

/** Relativna luminansa po WCAG-u. */
function luminance(hex: string): number {
  const channel = (from: number): number => {
    const value = Number.parseInt(hex.slice(from, from + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Odnos kontrasta po WCAG-u, između 1 i 21. */
function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
}

/**
 * Tekst koji se na ovu pozadinu najbolje vidi.
 *
 * Ranije je ovde stajao prag luminanse od 0.35 i par `#f7f7f7` / `#141414`.
 * Na srednjim tonovima je birao pogrešnu stranu: `#999999` je dobijao svetao
 * tekst sa odnosom 2.66, dok bi mu taman dao 6.64. Salon bira boju, ne
 * kontrast, pa se ne sme pogađati — meri se oba i uzima bolje.
 *
 * Čisto belo i čisto crno, a ne blaži par, jer se samo sa njima presek nikad
 * ne spusti ispod 4.5 koliko WCAG AA traži za tekst.
 */
function readableOn(background: string): string {
  return contrast(background, "#ffffff") >= contrast(background, "#000000")
    ? "#ffffff"
    : "#000000";
}

/** Da li je pozadina tamna — sad se čita iz izbora teksta, ne iz praga. */
export function isDark(hex: string): boolean {
  return readableOn(hex) === "#ffffff";
}

/** Meša dve boje u sRGB-u; `ratio` je koliko ostaje od prve. */
function blend(a: string, b: string, ratio: number): string {
  const channel = (from: number): string => {
    const mixed =
      Number.parseInt(a.slice(from, from + 2), 16) * ratio +
      Number.parseInt(b.slice(from, from + 2), 16) * (1 - ratio);
    return Math.round(mixed).toString(16).padStart(2, "0");
  };

  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/** WCAG AA za tekst normalne veličine. */
const AA = 4.5;

/**
 * Najtiša nijansa `ink` na podlozi `surface` koja se još uvek čita.
 *
 * Prigušen tekst treba da bude tiši od glavnog, ali ne i nečitljiv. Umesto
 * fiksnog procenta — koji je na belom davao 4.48, a na `#777777` ne bi prošao
 * ni na sto posto — traži se najmanje mešanje koje pređe prag. `null` kad ni
 * puna boja ne prolazi, što znači da je podloga sama preblizu tekstu.
 */
function quietest(ink: string, surface: string, toward: string): string | null {
  for (let percent = 55; percent <= 100; percent += 5) {
    const candidate = blend(ink, toward, percent / 100);
    if (contrast(candidate, surface) >= AA) {
      return candidate;
    }
  }

  return null;
}

/**
 * Ista boja ako se vidi, primaknuta tek koliko mora ako se ne vidi.
 *
 * Za razliku od `quietest`, ovde je cilj **sačuvati** boju koju je salon
 * izabrao. Dira se samo kad padne ispod praga, i to najmanje moguće.
 */
function legible(ink: string, surface: string, toward: string): string | null {
  for (let percent = 100; percent >= 0; percent -= 5) {
    const candidate = blend(ink, toward, percent / 100);
    if (contrast(candidate, surface) >= AA) {
      return candidate;
    }
  }

  return null;
}

/**
 * Boje salona kao CSS promenljive koje Tailwind tema već čita.
 *
 * Zato nijedna komponenta ne zna za salon: menja se vrednost promenljive, ne
 * klasa. Salon koji nije izabrao boje vraća `null` i ostaje na podrazumevanom.
 *
 * Vrednosti koje nose tekst računaju se ovde do konkretnog heksa, umesto da se
 * prepuste `color-mix`-u — samo tako se kontrast može izmeriti pre nego što
 * stigne u pregledač, i samo tako ga test može proveriti.
 */
export function brandVariables(brand: Brand): string | null {
  const background = clean(brand.background);
  const primary = clean(brand.primary);
  const accent = clean(brand.accent);

  if (background === null || primary === null) {
    return null;
  }

  const foreground = readableOn(background);
  const dark = foreground === "#ffffff";
  const lift = dark ? "#ffffff" : "#000000";

  // Kartica se izdiže ka boji teksta, pa svako izdizanje jede kontrast. Na
  // srednjim tonovima pojede ga ceo: `#777777` sa crnim tekstom ima 4.70, a
  // već izdignuta podloga padne ispod praga. Zato se izdizanje bira, ne
  // pretpostavlja — kad smeta, dan ostaje ravan, a karticu i dalje odvaja
  // ivica, koja ionako nosi boju salona.
  const elevation =
    quietest(foreground, blend(background, lift, 0.88), background) === null
      ? 0
      : 0.12;

  const surface = blend(background, lift, 1 - elevation * 0.67);
  const muted = blend(background, lift, 1 - elevation);

  // Kad ni puna boja ne prolazi, prigušenog teksta prosto nema — bolje isti
  // tekst kao svuda nego tekst koji se ne vidi.
  const mutedForeground = quietest(foreground, muted, background) ?? foreground;

  // Cena se ispisuje bojom koju je salon izabrao za isticanje. Ako se ta boja
  // na svojoj podlozi ne vidi, primiče se tekstu dok se ne vidi — salon dobije
  // svoj ton koliko god ga može dobiti, a cena ostaje čitljiva.
  const brandAccent =
    legible(accent ?? primary, surface, foreground) ?? foreground;

  const declarations: Record<string, string> = {
    "--background": background,
    "--foreground": foreground,
    "--card": surface,
    "--card-foreground": foreground,
    "--popover": surface,
    "--popover-foreground": foreground,
    "--primary": primary,
    "--primary-foreground": readableOn(primary),
    "--secondary": muted,
    "--secondary-foreground": foreground,
    "--muted": muted,
    "--muted-foreground": mutedForeground,
    "--accent": blend(background, lift, 1 - elevation * 1.17),
    "--accent-foreground": foreground,
    // Ivice nose boju salona, kao prsten oko logoa.
    "--border": `color-mix(in srgb, ${primary} 38%, transparent)`,
    "--input": `color-mix(in srgb, ${primary} 46%, transparent)`,
    "--ring": primary,
    "--destructive": dark ? blend(primary, "#ffffff", 0.7) : primary,
    "--brand-accent": brandAccent,
  };

  return Object.entries(declarations)
    .map(([name, value]) => `${name}:${value}`)
    .join(";");
}
