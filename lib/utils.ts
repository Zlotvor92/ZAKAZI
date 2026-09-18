import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Da li je ovo `redirect()` iz server akcije, a ne pad.
 *
 * Akcija koja uspe pa preusmeri javlja to greškom sa `NEXT_REDIRECT`. Forma
 * koja hvata pad poziva mora da je propusti dalje do rutera — inače bi se
 * posle svakog uspešnog upisa ispisalo da ništa nije sačuvano.
 */
export function isRedirect(cause: unknown): boolean {
  return cause instanceof Error && cause.message.includes("NEXT_REDIRECT");
}
