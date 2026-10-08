import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasPushSubscription: vi.fn(),
  removePushSubscription: vi.fn(),
  savePushSubscription: vi.fn(),
  getCurrentTenant: vi.fn(),
  selectedTenantId: vi.fn(),
  getUser: vi.fn(),
  sendTestPush: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/push")>()),
  hasPushSubscription: mocks.hasPushSubscription,
  removePushSubscription: mocks.removePushSubscription,
  savePushSubscription: mocks.savePushSubscription,
}));
vi.mock("@/lib/db/tenants", () => ({
  getCurrentTenant: mocks.getCurrentTenant,
  updateBookingSettings: vi.fn(),
}));
vi.mock("@/lib/tenant", () => ({ selectedTenantId: mocks.selectedTenantId }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock("@/lib/messaging/push", () => ({ sendTestPush: mocks.sendTestPush }));

import {
  checkNotifications,
  disableNotifications,
  enableNotifications,
  sendTestNotification,
} from "@/app/(dashboard)/dashboard/podesavanja/actions";

const TENANT_A = "9a7b4c11-1f0d-4d1a-8d36-2e7c7f2a5e44";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/uredjaj";

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    mock.mockReset();
  }
  mocks.selectedTenantId.mockResolvedValue(TENANT_A);
  mocks.getCurrentTenant.mockResolvedValue({ id: TENANT_A, name: "Studio" });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
});

describe("checkNotifications", () => {
  it("javlja „uključeno“ samo kad server ima pretplatu za izabrani salon", async () => {
    mocks.hasPushSubscription.mockResolvedValue(true);

    expect(await checkNotifications(ENDPOINT)).toBe("on");
    expect(mocks.hasPushSubscription).toHaveBeenCalledWith({
      tenantId: TENANT_A,
      endpoint: ENDPOINT,
    });
  });

  it("pregledač pretplaćen, server ne zna za salon: „isključeno“, ne „uključeno“", async () => {
    mocks.hasPushSubscription.mockResolvedValue(false);

    expect(await checkNotifications(ENDPOINT)).toBe("off");
  });

  it("pad provere je „nepoznato“, ne lažno „uključeno“ ni „isključeno“", async () => {
    mocks.hasPushSubscription.mockRejectedValue(new Error("mreža"));

    expect(await checkNotifications(ENDPOINT)).toBe("unknown");
  });

  it("bez salona ne tvrdi ništa", async () => {
    mocks.getCurrentTenant.mockResolvedValue(null);

    expect(await checkNotifications(ENDPOINT)).toBe("unknown");
  });

  it("endpoint van liste se ne pita u bazi", async () => {
    expect(await checkNotifications("https://attacker.example.test/x")).toBe(
      "off",
    );
    expect(mocks.hasPushSubscription).not.toHaveBeenCalled();
  });
});

describe("disableNotifications", () => {
  it("gasi samo izabrani salon i javlja da li ga drugi salon još koristi", async () => {
    mocks.removePushSubscription.mockResolvedValue({ remainingElsewhere: 1 });

    const result = await disableNotifications(ENDPOINT);

    expect(mocks.removePushSubscription).toHaveBeenCalledWith({
      tenantId: TENANT_A,
      endpoint: ENDPOINT,
    });
    expect(result).toEqual({ ok: true, remainingElsewhere: 1 });
  });

  it("greška servera nije uspeh: ekran ne sme da prikaže isključeno", async () => {
    mocks.removePushSubscription.mockRejectedValue(new Error("pao"));

    expect(await disableNotifications(ENDPOINT)).toEqual({ ok: false });
  });

  it("nevažeći endpoint se ne šalje bazi", async () => {
    expect(await disableNotifications("nije adresa")).toEqual({ ok: false });
    expect(mocks.removePushSubscription).not.toHaveBeenCalled();
  });
});

describe("enableNotifications", () => {
  const keys = { p256dh: "k", auth: "a" };

  it("pamti pretplatu za izabrani salon i prijavljenog korisnika", async () => {
    expect(await enableNotifications({ endpoint: ENDPOINT, keys })).toBe(true);
    expect(mocks.savePushSubscription).toHaveBeenCalledWith({
      tenantId: TENANT_A,
      userId: "user-1",
      subscription: { endpoint: ENDPOINT, keys },
    });
  });

  it("odbija endpoint koji nije push servis pregledača", async () => {
    expect(
      await enableNotifications({
        endpoint: "https://attacker.example.test/collect",
        keys,
      }),
    ).toBe(false);
    expect(mocks.savePushSubscription).not.toHaveBeenCalled();
  });
});

describe("sendTestNotification", () => {
  it("šalje samo na uređaje prijavljenog korisnika za izabrani salon", async () => {
    mocks.sendTestPush.mockResolvedValue({ status: "accepted", devices: 1 });

    expect(await sendTestNotification()).toBe("accepted");
    expect(mocks.sendTestPush).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_A, userId: "user-1" }),
    );
  });

  it("prenosi ishod servisa bez prikrivanja", async () => {
    mocks.sendTestPush.mockResolvedValue({ status: "failed" });
    expect(await sendTestNotification()).toBe("failed");

    mocks.sendTestPush.mockResolvedValue({ status: "no_devices" });
    expect(await sendTestNotification()).toBe("no_devices");
  });
});
