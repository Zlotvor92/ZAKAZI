import type { Metadata } from "next";

/**
 * Javna strana ne nosi manifest platforme.
 *
 * `app/manifest.ts` postoji zbog vlasnice: na iOS-u obaveštenja rade samo kad
 * je sajt dodat na početni ekran, a to traži manifest sa `standalone`. Taj
 * manifest ima `start_url: /dashboard` i ime platforme — i Next ga ubacuje u
 * svaku stranu, pa i u salonovu. Klijentkinja koja doda stranicu salona na
 * početni ekran dobijala je ikonu sa imenom „Doteraj Me" koja otvara prijavu
 * vlasnice.
 *
 * Bez manifesta „dodaj na početni ekran" pravi običnu prečicu: otvara pravu
 * adresu salona i nosi ime iz `<title>`, dakle ime salona.
 */
export const metadata: Metadata = {
  manifest: null,
};

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
