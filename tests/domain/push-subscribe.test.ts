import { describe, expect, it, vi } from "vitest";
import { subscribeDevice } from "@/lib/push-subscribe";

function key(...bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

function subscription(applicationServerKey: ArrayBuffer | null) {
  return { options: { applicationServerKey } } as unknown as PushSubscription;
}

const KEY = key(1, 2, 3);
const noPause = vi.fn(async () => {});

describe("subscribeDevice", () => {
  it("koristi postojeću pretplatu istog ključa i ne zove subscribe", async () => {
    const existing = subscription(key(1, 2, 3));
    const manager = {
      getSubscription: vi.fn(async () => existing),
      subscribe: vi.fn(),
    };

    expect(await subscribeDevice(manager, KEY, noPause)).toBe(existing);
    expect(manager.subscribe).not.toHaveBeenCalled();
  });

  it("pretplatu drugog ključa ne koristi: subscribe sam javlja grešku", async () => {
    const created = subscription(KEY);
    const manager = {
      getSubscription: vi.fn(async () => subscription(key(9, 9, 9))),
      subscribe: vi.fn(async () => created),
    };

    expect(await subscribeDevice(manager, KEY, noPause)).toBe(created);
    expect(manager.subscribe).toHaveBeenCalledTimes(1);
  });

  it("bez postojeće pretplate pravi novu", async () => {
    const created = subscription(KEY);
    const manager = {
      getSubscription: vi.fn(async () => null),
      subscribe: vi.fn(async () => created),
    };

    expect(await subscribeDevice(manager, KEY, noPause)).toBe(created);
    expect(manager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: KEY,
    });
  });

  it("AbortError: jedan ponovni pokušaj posle pauze", async () => {
    const created = subscription(KEY);
    const pause = vi.fn(async () => {});
    const manager = {
      getSubscription: vi.fn(async () => null),
      subscribe: vi
        .fn()
        .mockRejectedValueOnce(domError("AbortError"))
        .mockResolvedValueOnce(created),
    };

    expect(await subscribeDevice(manager, KEY, pause)).toBe(created);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(manager.subscribe).toHaveBeenCalledTimes(2);
  });

  it("AbortError i drugi put: greška se prosleđuje, bez trećeg pokušaja", async () => {
    const manager = {
      getSubscription: vi.fn(async () => null),
      subscribe: vi.fn().mockRejectedValue(domError("AbortError")),
    };

    await expect(subscribeDevice(manager, KEY, noPause)).rejects.toThrow(
      "AbortError",
    );
    expect(manager.subscribe).toHaveBeenCalledTimes(2);
  });

  it("druge greške se ne ponavljaju", async () => {
    const pause = vi.fn(async () => {});
    const manager = {
      getSubscription: vi.fn(async () => null),
      subscribe: vi.fn().mockRejectedValue(domError("NotAllowedError")),
    };

    await expect(subscribeDevice(manager, KEY, pause)).rejects.toThrow(
      "NotAllowedError",
    );
    expect(manager.subscribe).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
  });
});
