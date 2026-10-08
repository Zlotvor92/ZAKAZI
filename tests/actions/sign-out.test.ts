import { beforeEach, describe, expect, it, vi } from "vitest";

const { calls } = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    calls.push(`redirect:${to}`);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => ({
      delete: () => ({
        eq: async (column: string, value: string) => {
          calls.push(`delete:${table}:${column}=${value}`);
          return {};
        },
      }),
    }),
    auth: {
      signOut: async () => {
        calls.push("signOut");
      },
    },
  }),
}));
vi.mock("@/lib/db/appointments", () => ({}));
vi.mock("@/lib/db/clients", () => ({}));
vi.mock("@/lib/db/tenants", () => ({ getMyTenants: vi.fn() }));
vi.mock("@/lib/device", () => ({ deviceId: async () => "d" }));
vi.mock("@/lib/tenant", () => ({ selectTenant: vi.fn() }));

import { signOut } from "@/app/(dashboard)/dashboard/actions";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";

beforeEach(() => {
  calls.length = 0;
});

describe("signOut", () => {
  it("briše pretplatu ovog uređaja pre odjave, dok je sesija važeća", async () => {
    await expect(signOut(ENDPOINT)).rejects.toThrow("NEXT_REDIRECT");

    expect(calls).toEqual([
      `delete:push_subscriptions:endpoint=${ENDPOINT}`,
      "signOut",
      "redirect:/prijava",
    ]);
  });

  it("bez pretplate samo odjavljuje", async () => {
    await expect(signOut(undefined)).rejects.toThrow("NEXT_REDIRECT");

    expect(calls).toEqual(["signOut", "redirect:/prijava"]);
  });

  it("endpoint koji nije push servis pregledača se ne šalje bazi", async () => {
    await expect(signOut("https://attacker.example.test/x")).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    expect(calls).toEqual(["signOut", "redirect:/prijava"]);
  });
});
