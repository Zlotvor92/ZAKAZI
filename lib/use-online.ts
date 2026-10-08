"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);

  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Da li pregledač misli da ima mrežu. `false` je pouzdan (veze zaista nema),
 * `true` nije garancija: telefon na mreži bez interneta se i dalje javlja kao
 * povezan. Zato „online" ovde znači samo „nema razloga da se ne pokuša".
 *
 * Na serveru je `true`, da prvo crtanje ne bi pokazalo grešku svima.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
