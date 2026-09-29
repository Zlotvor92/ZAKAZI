import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { complete, prune } = vi.hoisted(() => ({ complete: vi.fn(), prune: vi.fn() }));

vi.mock("@/lib/db/appointments", () => ({ completePastAppointments: complete }));
vi.mock("@/lib/db/public-cancel", () => ({ prunePhoneLookupAttempts: prune }));

import { GET } from "@/app/api/cron/obavljeni-termini/route";

function call(authorization?: string): Promise<Response> {
  return GET(
    new NextRequest("http://localhost/api/cron/obavljeni-termini", {
      headers: authorization ? { authorization } : {},
    }),
  );
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "tajna-tajna-tajna");
  complete.mockReset().mockResolvedValue(3);
  prune.mockReset().mockResolvedValue(41);
});

describe("noćni posao", () => {
  it("bez tajne: 401 i ništa se ne menja", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer pogresna")).status).toBe(401);
    expect(complete).not.toHaveBeenCalled();
    expect(prune).not.toHaveBeenCalled();
  });

  it("sa tajnom završava termine i čisti pretragu", async () => {
    const response = await call("Bearer tajna-tajna-tajna");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ completed: 3, pruned: 41 });
  });
});
