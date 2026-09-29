import { beforeEach, describe, expect, it, vi } from "vitest";

const { isPlatformOwner, ensureUser, createSalon } = vi.hoisted(() => ({
  isPlatformOwner: vi.fn(),
  ensureUser: vi.fn(),
  createSalon: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/db/admin", () => ({
  createSalon,
  deleteSalon: vi.fn(),
  isPlatformOwner,
  setSalonLogo: vi.fn(),
  setSalonPaidUntil: vi.fn(),
  setSalonSuspended: vi.fn(),
}));
vi.mock("@/lib/db/errors", () => ({ clearErrors: vi.fn() }));
vi.mock("@/lib/db/logo", () => ({ removeLogoFiles: vi.fn(), uploadLogo: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ ensureUser }));
vi.mock("@/app/(dashboard)/dashboard/actions", () => ({ switchTenant: vi.fn() }));

import { addSalon } from "@/app/(dashboard)/admin/actions";

function form(): FormData {
  const data = new FormData();
  data.set("name", "Studio Nova");
  data.set("slug", "studio-nova");
  data.set("ownerEmail", "vlasnica@primer.rs");
  return data;
}

beforeEach(() => {
  isPlatformOwner.mockReset();
  ensureUser.mockReset();
  createSalon.mockReset();
});

describe("addSalon", () => {
  it("ko nije vlasnik platforme ne pokreće pravljenje naloga preko service_role", async () => {
    isPlatformOwner.mockResolvedValue(false);

    const result = await addSalon(form());

    expect(result.status).toBe("error");
    expect(ensureUser).not.toHaveBeenCalled();
    expect(createSalon).not.toHaveBeenCalled();
  });

  it("vlasnik platforme pravi nalog pa salon", async () => {
    isPlatformOwner.mockResolvedValue(true);
    ensureUser.mockResolvedValue(true);
    createSalon.mockResolvedValue({ ok: true, id: "3b1d1c86-3d3c-4b0a-8a16-6f1f5c0a9d33" });

    await addSalon(form());

    expect(ensureUser).toHaveBeenCalledWith("vlasnica@primer.rs");
    expect(createSalon).toHaveBeenCalledTimes(1);
  });
});
