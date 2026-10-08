import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(
  path.join(process.cwd(), "public", "sw.js"),
  "utf8",
);

const ORIGIN = "https://doterajme.test";

type FakeWindow = {
  url: string;
  visibilityState: "visible" | "hidden";
  focus: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
};

function fakeWindow(
  pathname: string,
  options: { visible?: boolean; navigateFails?: boolean } = {},
): FakeWindow {
  const self: FakeWindow = {
    url: `${ORIGIN}${pathname}`,
    visibilityState: options.visible === false ? "hidden" : "visible",
    focus: vi.fn(async () => self),
    navigate: vi.fn(async () => {
      if (options.navigateFails) {
        throw new TypeError("navigate nije dozvoljen");
      }
    }),
    postMessage: vi.fn(),
  };
  return self;
}

function loadWorker(windows: FakeWindow[]) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const showNotification = vi.fn(async () => {});
  const openWindow = vi.fn(async () => null);

  const scope = {
    addEventListener: (name: string, handler: (event: unknown) => void) => {
      listeners[name] = handler;
    },
    skipWaiting: vi.fn(),
    location: { origin: ORIGIN },
    registration: { showNotification },
    clients: {
      claim: vi.fn(),
      matchAll: vi.fn(async () => windows),
      openWindow,
    },
  };

  vm.runInNewContext(source, { self: scope, URL });

  async function dispatch(name: string, event: Record<string, unknown>) {
    const pending: Promise<unknown>[] = [];
    listeners[name]!({
      ...event,
      waitUntil: (work: Promise<unknown>) => pending.push(work),
    });
    await Promise.all(pending);
  }

  return { dispatch, showNotification, openWindow };
}

const payload = {
  title: "Novo zakazivanje",
  body: "Jelena",
  url: "/dashboard/otvori?salon=s1&dan=2026-10-12",
  tag: "zakazano:1",
};

function pushEvent() {
  return { data: { json: () => payload } };
}

function clickEvent(url = payload.url) {
  return { notification: { close: vi.fn(), data: { url } } };
}

describe("push poruka", () => {
  it("pokazuje obaveštenje i kaže otvorenom kalendaru da se osveži", async () => {
    const calendar = fakeWindow("/dashboard?dan=2026-10-08");
    const worker = loadWorker([calendar]);

    await worker.dispatch("push", pushEvent());

    expect(worker.showNotification).toHaveBeenCalledTimes(1);
    expect(calendar.postMessage).toHaveBeenCalledWith({ type: "refresh" });
  });

  it("ne šalje poruku prozoru koji nije kalendar", async () => {
    const other = fakeWindow("/uslovi-koriscenja");
    const worker = loadWorker([other]);

    await worker.dispatch("push", pushEvent());

    expect(other.postMessage).not.toHaveBeenCalled();
    expect(worker.showNotification).toHaveBeenCalledTimes(1);
  });
});

describe("dodir na obaveštenje", () => {
  it("otvoren kalendar se fokusira i vodi na dan i salon iz obaveštenja", async () => {
    const calendar = fakeWindow("/dashboard?dan=2026-10-08");
    const worker = loadWorker([calendar]);

    await worker.dispatch("notificationclick", clickEvent());

    expect(calendar.focus).toHaveBeenCalled();
    expect(calendar.navigate).toHaveBeenCalledWith(`${ORIGIN}${payload.url}`);
    expect(worker.openWindow).not.toHaveBeenCalled();
  });

  it("vidljiva kartica ima prednost nad onom u pozadini", async () => {
    const background = fakeWindow("/dashboard", { visible: false });
    const visible = fakeWindow("/dashboard?dan=2026-10-09");
    const worker = loadWorker([background, visible]);

    await worker.dispatch("notificationclick", clickEvent());

    expect(visible.navigate).toHaveBeenCalled();
    expect(background.navigate).not.toHaveBeenCalled();
  });

  it("kad pregledač ne dozvoli navigate, otvara novu karticu", async () => {
    const calendar = fakeWindow("/dashboard", { navigateFails: true });
    const worker = loadWorker([calendar]);

    await worker.dispatch("notificationclick", clickEvent());

    expect(worker.openWindow).toHaveBeenCalledWith(`${ORIGIN}${payload.url}`);
  });

  it("bez otvorenog kalendara otvara novu karticu", async () => {
    const worker = loadWorker([fakeWindow("/uslovi-koriscenja")]);

    await worker.dispatch("notificationclick", clickEvent());

    expect(worker.openWindow).toHaveBeenCalledWith(`${ORIGIN}${payload.url}`);
  });

  it("zatvara obaveštenje", async () => {
    const worker = loadWorker([]);
    const event = clickEvent();

    await worker.dispatch("notificationclick", event);

    expect(event.notification.close).toHaveBeenCalled();
  });
});
