/**
 * Push servisi pregledača koji smeju da prime obaveštenje.
 *
 * Server šalje POST na adresu koju je poslao pregledač, pa bi bez ove liste
 * svaki prijavljen korisnik mogao da natera server da zove proizvoljan host.
 * Ista lista stoji i u bazi (`push_subscriptions_endpoint_allowed`); ako se
 * ovde doda host, mora i tamo.
 *
 * - Chrome, Brave, Opera, Samsung: `fcm.googleapis.com`
 * - Firefox: `updates.push.services.mozilla.com`
 * - Safari, iPhone aplikacija sa početnog ekrana: `*.push.apple.com`
 * - Edge: `*.notify.windows.com`
 */
const EXACT_HOSTS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
]);

const SUFFIX_HOSTS = [".push.apple.com", ".notify.windows.com"];

export function isAllowedPushEndpoint(raw: string): boolean {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") {
    return false;
  }

  // Korisničko ime i lozinka u adresi: `https://fcm.googleapis.com@evil.test/`
  // ima ime hosta `evil.test`, ali čitaocu izgleda kao Google.
  if (url.username !== "" || url.password !== "") {
    return false;
  }

  if (url.port !== "") {
    return false;
  }

  const host = url.hostname;

  if (EXACT_HOSTS.has(host)) {
    return true;
  }

  return SUFFIX_HOSTS.some(
    (suffix) =>
      host.endsWith(suffix) &&
      // Neprazna oznaka ispred sufiksa, bez tačke na kraju imena.
      host.length > suffix.length &&
      /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host.slice(0, -suffix.length)),
  );
}
