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
