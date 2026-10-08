/**
 * Adresa na koju vodi obaveštenje. Nosi salon, jer vlasnica sa dva salona ima
 * u kolačiću samo jedan izabran — dodir na obaveštenje drugog salona bi je
 * inače odveo u pogrešan kalendar. Rutu `/dashboard/otvori` proverava članstvo
 * pre nego što salon izabere.
 */
export function dashboardLink(input: { tenantId: string; day: string }): string {
  const params = new URLSearchParams({ salon: input.tenantId, dan: input.day });
  return `/dashboard/otvori?${params.toString()}`;
}
