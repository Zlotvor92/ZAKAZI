import type { Metadata } from "next";
import { sr } from "@/lib/i18n/sr";
import { Notice } from "./page";

export const metadata: Metadata = {
  title: sr.booking.unavailableTitle,
};

/**
 * Postoji da bi nepoznat slug dobio status 404 a zadržao poruku koju je javna
 * strana i ranije pokazivala. Bez ovoga bi `notFound()` odveo na opštu stranu
 * platforme („Ove stranice nema"), koja klijentkinji koja je dobila link od
 * salona ne znači ništa.
 *
 * Poruka je namerno ista za nepoznat salon, ugašeno zakazivanje i suspendovan
 * salon — razlika među njima bi odala koji slugovi postoje.
 */
export default function SalonNotFound() {
  return <Notice title={sr.app.name} message={sr.booking.closed} />;
}
