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

/**
 * Da li se na ovu pozadinu piše belim.
 *
 * Relativna luminansa po WCAG-u. Salon bira boju, ne kontrast, pa aplikacija
 * mora sama da odluči — inače prvi salon koji izabere svetlu pozadinu dobije
 * belo na belom.
 */
export function isDark(hex: string): boolean {
  const channel = (from: number): number => {
    const value = Number.parseInt(hex.slice(from, from + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  const luminance =
    0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);

  return luminance < 0.35;
}

/**
 * Boje salona kao CSS promenljive koje Tailwind tema već čita.
 *
 * Zato nijedna komponenta ne zna za salon: menja se vrednost promenljive, ne
 * klasa. Salon koji nije izabrao boje vraća `null` i ostaje na podrazumevanom.
 */
export function brandVariables(brand: Brand): string | null {
  const background = clean(brand.background);
  const primary = clean(brand.primary);
  const accent = clean(brand.accent);

  if (background === null || primary === null) {
    return null;
  }

  const dark = isDark(background);
  const foreground = dark ? "#f7f7f7" : "#141414";
  const lift = dark ? "#ffffff" : "#000000";

  const declarations: Record<string, string> = {
    "--background": background,
    "--foreground": foreground,
    "--card": `color-mix(in srgb, ${background} 92%, ${lift})`,
    "--card-foreground": foreground,
    "--popover": `color-mix(in srgb, ${background} 92%, ${lift})`,
    "--popover-foreground": foreground,
    "--primary": primary,
    "--primary-foreground": isDark(primary) ? "#ffffff" : "#141414",
    "--secondary": `color-mix(in srgb, ${background} 88%, ${lift})`,
    "--secondary-foreground": foreground,
    "--muted": `color-mix(in srgb, ${background} 88%, ${lift})`,
    "--muted-foreground": `color-mix(in srgb, ${foreground} 58%, ${background})`,
    "--accent": `color-mix(in srgb, ${background} 86%, ${lift})`,
    "--accent-foreground": foreground,
    // Ivice nose boju salona, kao prsten oko logoa.
    "--border": `color-mix(in srgb, ${primary} 38%, transparent)`,
    "--input": `color-mix(in srgb, ${primary} 46%, transparent)`,
    "--ring": primary,
    "--destructive": dark
      ? `color-mix(in srgb, ${primary} 70%, #ffffff)`
      : primary,
    "--brand-accent": accent ?? primary,
  };

  return Object.entries(declarations)
    .map(([name, value]) => `${name}:${value}`)
    .join(";");
}
