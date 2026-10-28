/**
 * Najveći logo koji sajt prima. Server Action prima zahtev tek ispod
 * `serverActions.bodySizeLimit` iz `next.config.ts`, a ta granica mora da
 * stane i sam fajl i omot zahteva (`multipart`, ostala polja). Zato je tamo
 * 3 MB, a ovde 2 MB: fajl do 2 MB uvek stigne do provere tipa i veličine, pa
 * poruka „najviše 2 MB" važi za sve što je veće, a ne samo za nešto veće.
 */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** Mora da bude veće od `LOGO_MAX_BYTES` uz prostor za omot zahteva. */
export const SERVER_ACTION_BODY_LIMIT_BYTES = 3 * 1024 * 1024;

/**
 * Kraća stranica logoa posle smanjivanja. Logo se prikazuje kao krug od 72 px
 * sa `object-cover`, pa kraća stranica mora da pokrije 72 px i na ekranu
 * gustine 4x. Original sa telefona ume da bude 4000 px i nekoliko megabajta za
 * sliku koja na strani zauzima palac.
 */
export const LOGO_EDGE_PX = 288;

/**
 * Dimenzije na koje se logo smanjuje. Kraća stranica staje na `edge`, jer
 * `object-cover` seče dužu; manja slika se ne uvećava.
 */
export function logoTargetSize(
  width: number,
  height: number,
  edge: number = LOGO_EDGE_PX,
): { width: number; height: number } {
  const scale = Math.min(1, edge / Math.min(width, height));

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
