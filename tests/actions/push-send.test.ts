import { beforeEach, describe, expect, it, vi } from "vitest";

const { send, setVapid } = vi.hoisted(() => ({
  send: vi.fn(),
  setVapid: vi.fn(),
}));

vi.mock("web-push", () => ({
  default: { sendNotification: send, setVapidDetails: setVapid },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) =>
      table === "push_subscriptions"
        ? {
            select: () => ({
              eq: async () => ({
                data: [
                  { id: "s1", endpoint: "https://fcm.test/1", p256dh: "k", auth: "a" },
                ],
                error: null,
              }),
            }),
            delete: () => ({ in: async () => ({}) }),
          }
        : { insert: async () => ({}) },
  }),
}));

import { notifyTenant, SEND_OPTIONS } from "@/lib/messaging/push";

beforeEach(() => {
  send.mockReset();
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

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![2]).toEqual(SEND_OPTIONS);
    expect(SEND_OPTIONS.urgency).toBe("high");
    expect(SEND_OPTIONS.TTL).toBeGreaterThan(0);
  });
});
