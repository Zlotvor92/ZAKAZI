import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { logError } from "@/lib/db/errors";

beforeEach(() => {
  rpc.mockReset();
});

describe("logError", () => {
  it("token kalendara ne stiže do baze grešaka", async () => {
    rpc.mockResolvedValue({ error: null });

    await logError({
      source: "server",
      message: "puklo",
      path: "/api/kalendar/salon/6f1c3a52-0a9e-4a2e-9f0e-0d5b4c1f7a11.ics",
    });

    expect(rpc).toHaveBeenCalledWith(
      "log_error",
      expect.objectContaining({ p_path: "/api/kalendar/salon/[token].ics" }),
    );
  });

  it("pad upisa ne baca izuzetak", async () => {
    rpc.mockImplementation(async () => {
      throw new Error("baza nedostupna");
    });

    let thrown: unknown = null;
    try {
      await logError({ source: "server", message: "x" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeNull();
  });
});
