import { beforeEach, describe, expect, it, vi } from "vitest";

const { send, setVapid, inserted, deleted, members } = vi.hoisted(() => ({
  send: vi.fn(),
  setVapid: vi.fn(),
  inserted: [] as Record<string, unknown>[][],
  deleted: [] as string[][],
  /** Korisnici koji su trenutno članovi salona. */
  members: { current: ["u1"] as string[] },
}));

vi.mock("web-push", () => ({
  default: { sendNotification: send, setVapidDetails: setVapid },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) =>
      table === "push_subscriptions"
        ? {
            select: () => {
              const result = {
                data: [
                  {
                    id: "s1",
                    user_id: "u1",
                    endpoint: "https://fcm.googleapis.com/fcm/send/1",
                    p256dh: "k",
                    auth: "a",
                  },
                  {
                    id: "s2",
                    user_id: "u1",
                    endpoint: "https://attacker.example.test/collect",
                    p256dh: "k",
                    auth: "a",
                  },
                  {
                    id: "s3",
                    user_id: "u2",
                    endpoint: "https://fcm.googleapis.com/fcm/send/3",
                    p256dh: "k",
                    auth: "a",
                  },
                ],
                error: null,
              };
              const chain = {
                eq: () => Object.assign(Promise.resolve(result), chain),
              };
              return chain;
            },
            delete: () => ({
              in: async (_column: string, ids: string[]) => {
                deleted.push(ids);
                return {};
              },
            }),
          }
        : table === "memberships"
          ? {
              select: () => ({
                eq: () => ({
                  in: async () => ({
                    data: members.current.map((user_id) => ({ user_id })),
                    error: null,
                  }),
                }),
              }),
            }
          : {
            insert: async (rows: Record<string, unknown>[]) => {
              inserted.push(rows);
              return {};
            },
          },
  }),
}));

import {
  notifyTenant,
  SEND_OPTIONS,
  sendTestPush,
} from "@/lib/messaging/push";

beforeEach(() => {
  send.mockReset();
  inserted.length = 0;
  deleted.length = 0;
  members.current = ["u1"];
  process.env["VAPID_SUBJECT"] = "mailto:test@example.com";
  process.env["NEXT_PUBLIC_VAPID_PUBLIC_KEY"] = "pub";
  process.env["VAPID_PRIVATE_KEY"] = "priv";
});

describe("notifyTenant", () => {
  it("šalje sa visokom hitnošću, da Doze ne zadrži obaveštenje", async () => {
    send.mockResolvedValue({ statusCode: 201 });

    await notifyTenant({
      tenantId: "t",
      appointmentId: "a",
      template: "new_booking",
      payload: { title: "x", body: "y", url: "/dashboard", tag: "z" },
    });

    // Drugi red ima endpoint koji nije push servis pregledača i ne sme da se zove.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].endpoint).toBe(
      "https://fcm.googleapis.com/fcm/send/1",
    );
    expect(send.mock.calls[0]![2]).toEqual(SEND_OPTIONS);
    expect(SEND_OPTIONS.urgency).toBe("high");
    expect(SEND_OPTIONS.TTL).toBeGreaterThan(0);
  });
});

describe("sendTestPush", () => {
  const payload = { title: "Probno", body: "x", url: "/dashboard", tag: "test" };

  it("prihvaćeno slanje javlja samo da je servis primio poruku", async () => {
    send.mockResolvedValue({ statusCode: 201 });

    const result = await sendTestPush({ tenantId: "t", userId: "u", payload });

    // Drugi uređaj ima endpoint van liste, pa je jedan prihvaćen.
    expect(result).toEqual({ status: "accepted", devices: 1 });
  });

  it("odbijanje servisa se ne prikazuje kao uspeh", async () => {
    send.mockRejectedValue({ statusCode: 500 });

    const result = await sendTestPush({ tenantId: "t", userId: "u", payload });

    expect(result).toEqual({ status: "failed" });
  });

  it("upisuje poruku u dnevnik bez termina, uz šablon „test“", async () => {
    send.mockResolvedValue({ statusCode: 201 });

    await sendTestPush({ tenantId: "t", userId: "u", payload });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenant_id: "t",
          appointment_id: null,
          template: "test",
          channel: "push",
          status: "sent",
        }),
        expect.objectContaining({ status: "failed" }),
      ]),
    );
  });

  it("bez podešenih VAPID ključeva javlja da obaveštenja nisu dostupna", async () => {
    delete process.env["VAPID_PRIVATE_KEY"];

    // `configure` pamti da je jednom uspela, pa je potreban svež modul.
    vi.resetModules();
    const fresh = await import("@/lib/messaging/push");
    const result = await fresh.sendTestPush({
      tenantId: "t",
      userId: "u",
      payload,
    });

    expect(result).toEqual({ status: "unavailable" });
  });
});

describe("članstvo pri slanju", () => {
  const payload = { title: "x", body: "y", url: "/dashboard", tag: "z" };

  it("ne šalje uređaju korisnika koji više nije član salona i briše ga", async () => {
    send.mockResolvedValue({ statusCode: 201 });

    await notifyTenant({
      tenantId: "t",
      appointmentId: "a",
      template: "new_booking",
      payload,
    });

    const endpoints = send.mock.calls.map((call) => call[0].endpoint);
    expect(endpoints).toEqual(["https://fcm.googleapis.com/fcm/send/1"]);
    expect(deleted).toContainEqual(["s3"]);
  });

  it("kad nijedan korisnik nije član, ništa se ne šalje", async () => {
    members.current = [];

    await notifyTenant({
      tenantId: "t",
      appointmentId: "a",
      template: "new_booking",
      payload,
    });

    expect(send).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
    expect(deleted).toContainEqual(["s1", "s2", "s3"]);
  });

  it("uređaj člana ostaje u spisku i prima obaveštenje", async () => {
    members.current = ["u1", "u2"];
    send.mockResolvedValue({ statusCode: 201 });

    await notifyTenant({
      tenantId: "t",
      appointmentId: "a",
      template: "new_booking",
      payload,
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(deleted).toHaveLength(0);
  });
});
