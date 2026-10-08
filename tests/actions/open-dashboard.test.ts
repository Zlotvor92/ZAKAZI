import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMyTenants: vi.fn(),
  selectTenant: vi.fn(),
}));

vi.mock("@/lib/db/tenants", () => ({ getMyTenants: mocks.getMyTenants }));
vi.mock("@/lib/tenant", () => ({ selectTenant: mocks.selectTenant }));

import { GET } from "@/app/(dashboard)/dashboard/otvori/route";

const MINE = "9a7b4c11-1f0d-4d1a-8d36-2e7c7f2a5e44";
const THEIRS = "3b1d1c86-3d3c-4b0a-8a16-6f1f5c0a9d33";

function request(query: string): NextRequest {
  return new NextRequest(`https://doterajme.test/dashboard/otvori?${query}`);
}

beforeEach(() => {
  mocks.getMyTenants.mockReset();
  mocks.selectTenant.mockReset();
  mocks.getMyTenants.mockResolvedValue([{ id: MINE, slug: "moj", name: "Moj" }]);
});

describe("dodir na obaveštenje", () => {
  it("bira salon iz obaveštenja i otvara taj dan", async () => {
    const response = await GET(request(`salon=${MINE}&dan=2026-10-25`));

    expect(mocks.selectTenant).toHaveBeenCalledWith(MINE);
    expect(response.headers.get("location")).toBe(
      "https://doterajme.test/dashboard?dan=2026-10-25",
    );
  });

  it("salon u kome nalog nije član se ne bira, a ekran ostaje običan kalendar", async () => {
    const response = await GET(request(`salon=${THEIRS}&dan=2026-10-25`));

    expect(mocks.selectTenant).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://doterajme.test/dashboard",
    );
  });

  it.each([
    "salon=nije-uuid&dan=2026-10-25",
    `salon=${MINE}&dan=sutra`,
    `salon=${MINE}`,
    "",
  ])("neispravan upit (%s) ne dira kolačić", async (query) => {
    const response = await GET(request(query));

    expect(mocks.selectTenant).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://doterajme.test/dashboard",
    );
  });

  it("ne dozvoljava preusmeravanje van sajta preko parametra dana", async () => {
    const response = await GET(
      request(`salon=${MINE}&dan=//evil.test/`),
    );

    expect(response.headers.get("location")).toBe(
      "https://doterajme.test/dashboard",
    );
  });
});
