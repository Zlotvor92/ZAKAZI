import { Playfair_Display } from "next/font/google";

/**
 * Serif stoji ovde, a ne u `layout.tsx`, da ga ne vuče nijedna strana osim
 * onih koje ga stvarno koriste — početna i prijava. Deljen je zato što bi ga
 * inače svaka od njih učitala pod svojim imenom, a `next/font` bi ga onda
 * upisao dvaput.
 *
 * `latin-ext` je obavezan zbog č, ć, ž, š i đ, isto kao kod osnovnog fonta.
 */
export const display = Playfair_Display({
  subsets: ["latin", "latin-ext"],
  display: "swap",
});
