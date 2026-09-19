"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { sr } from "@/lib/i18n/sr";
import type { PushSubscriptionInput } from "@/lib/db/push";

type State =
  | "checking"
  | "off"
  | "on"
  | "blocked"
  | "unsupported"
  | "needs_home_screen";

/**
 * iPhone i iPad, uključujući iPad koji se predstavlja kao Mac sa ekranom na
 * dodir. Na njima obaveštenja postoje samo u aplikaciji sa početnog ekrana, pa
 * odsustvo API-ja nije „pregledač ne podržava" nego „nije još dodata".
 */
function isApplePhone(): boolean {
  const ua = navigator.userAgent;

  return (
    /iPhone|iPad|iPod/.test(ua) ||
    (ua.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

/** VAPID ključ putuje kao base64url, a `subscribe` traži sirove bajtove. */
function decodeKey(base64Url: string): ArrayBuffer {
  const padded = (base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);

  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }

  return buffer;
}

function toInput(subscription: PushSubscription): PushSubscriptionInput | null {
  const json = subscription.toJSON();

  if (!json.endpoint || !json.keys?.["p256dh"] || !json.keys["auth"]) {
    return null;
  }

  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys["p256dh"], auth: json.keys["auth"] },
  };
}

export function PushToggle({
  publicKey,
  onEnable,
  onDisable,
}: {
  publicKey: string;
  onEnable: (subscription: PushSubscriptionInput) => Promise<boolean>;
  onDisable: (endpoint: string) => Promise<void>;
}) {
  const [state, setState] = useState<State>("checking");
  const [apple, setApple] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    // Tek ovde, ne pri prvom crtanju: server ne zna koji je telefon u pitanju,
    // pa bi se prvi otisak razlikovao od onog u pregledaču.
    setApple(isApplePhone());

    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setState(isApplePhone() ? "needs_home_screen" : "unsupported");
      return;
    }

    if (Notification.permission === "denied") {
      setState("blocked");
      return;
    }

    navigator.serviceWorker
      .getRegistration()
      .then((registration) => registration?.pushManager.getSubscription())
      .then((subscription) => setState(subscription ? "on" : "off"))
      .catch(() => setState("off"));
  }, []);

  function enable() {
    setMessage(null);
    startTransition(async () => {
      let subscription: PushSubscription;

      // Dva koraka, dve poruke. Pregledač i server padaju iz različitih
      // razloga, a „Pokušaj ponovo" na oba je bilo tačno tek u polovini
      // slučajeva — i nije davalo ništa što bi se moglo javiti dalje.
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setState(permission === "denied" ? "blocked" : "off");
          return;
        }

        const registration = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;

        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeKey(publicKey),
        });
      } catch (cause) {
        // Ime greške je jedino po čemu se razlikuje telefon bez Google
        // servisa od pogrešnog ključa, a ona nema prevod koji bi značio
        // više — zato ide u zagradi, da može da se pročita i javi.
        const name = cause instanceof Error ? cause.name : "";
        setMessage(
          name
            ? `${sr.settings.pushBrowserFailed} (${name})`
            : sr.settings.pushBrowserFailed,
        );
        return;
      }

      const input = toInput(subscription);

      try {
        if (!input || !(await onEnable(input))) {
          setMessage(sr.settings.pushSaveFailed);
          return;
        }
      } catch {
        setMessage(sr.settings.pushSaveFailed);
        return;
      }

      setState("on");
    });
  }

  function disable() {
    startTransition(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();

      if (subscription) {
        await onDisable(subscription.endpoint);
        await subscription.unsubscribe();
      }

      setState("off");
    });
  }

  if (state === "checking") {
    return null;
  }

  // Na iPhone-u dugme ne sme ni da se pojavi dok stranica nije na početnom
  // ekranu — pritisak tada ne može da uspe. Umesto njega stoji šta da uradi.
  if (state === "needs_home_screen") {
    return <p className="text-sm">{sr.settings.pushIosHint}</p>;
  }

  if (state === "unsupported") {
    return (
      <p className="text-muted-foreground text-sm">
        {sr.settings.pushUnsupported}
      </p>
    );
  }

  if (state === "blocked") {
    return (
      <p role="alert" className="text-destructive text-sm">
        {sr.settings.pushBlocked}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm">
        {state === "on" ? sr.settings.pushOn : sr.settings.pushOff}
      </p>

      {state === "on" ? (
        <Button type="button" variant="outline" onClick={disable} disabled={pending}>
          {sr.settings.pushDisable}
        </Button>
      ) : (
        <Button type="button" className="h-12 w-full" onClick={enable} disabled={pending}>
          {pending ? sr.settings.pushEnabling : sr.settings.pushEnable}
        </Button>
      )}

      {message ? (
        <p role="alert" className="text-destructive text-sm">
          {message}
        </p>
      ) : null}

      {/* Uputstvo za iPhone je na Androidu bilo samo pogrešan savet ispod
          poruke o grešci. */}
      {apple ? (
        <p className="text-muted-foreground text-xs">
          {sr.settings.pushIosHint}
        </p>
      ) : null}
    </div>
  );
}
