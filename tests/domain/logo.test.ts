import { describe, expect, it, vi } from "vitest";

const upload = vi.fn(async () => ({ error: null }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        upload,
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://cdn.test/${path}` },
        }),
      }),
    },
  }),
}));

import nextConfig from "@/next.config";
import { uploadLogo } from "@/lib/db/logo";
import {
  LOGO_EDGE_PX,
  LOGO_MAX_BYTES,
  logoTargetSize,
  SERVER_ACTION_BODY_LIMIT_BYTES,
} from "@/lib/domain/logo";

function image(bytes: number, type = "image/png"): File {
  return new File([new Uint8Array(bytes)], "logo", { type });
}

/** `"3mb"` → bajtovi, kao što to čita Next. */
function megabytes(value: string | number | undefined): number {
  if (typeof value === "number") {
    return value;
  }
  const match = /^(\d+)\s*mb$/i.exec(value ?? "");
  return match ? Number(match[1]) * 1024 * 1024 : Number.NaN;
}

describe("granica Server Action zahteva i logo", () => {
  it("transportna granica je veća od najvećeg dozvoljenog loga, uz prostor za omot", () => {
    const configured = megabytes(
      nextConfig.experimental?.serverActions?.bodySizeLimit,
    );

    expect(configured).toBe(SERVER_ACTION_BODY_LIMIT_BYTES);
    expect(configured).toBeGreaterThan(LOGO_MAX_BYTES + 512 * 1024);
  });
});

describe("uploadLogo", () => {
  it.each([
    ["mali fajl", 10 * 1024],
    ["1,5 MB", 1.5 * 1024 * 1024],
    ["tačno 2 MB", LOGO_MAX_BYTES],
  ])("prima: %s", async (_name, bytes) => {
    const result = await uploadLogo({ tenantId: "t", file: image(bytes) });

    expect(result.ok).toBe(true);
  });

  it("odbija fajl preko 2 MB sa razlogom koji stranica ume da prikaže", async () => {
    const result = await uploadLogo({
      tenantId: "t",
      file: image(LOGO_MAX_BYTES + 1),
    });

    expect(result).toEqual({ ok: false, reason: "too_big" });
  });

  it("odbija neispravan tip, čak i kad je mali", async () => {
    const result = await uploadLogo({
      tenantId: "t",
      file: image(1024, "image/gif"),
    });

    expect(result).toEqual({ ok: false, reason: "wrong_type" });
  });
});
describe("logoTargetSize", () => {
  it("kvadrat sa telefona staje na ivicu", () => {
    expect(logoTargetSize(4000, 4000)).toEqual({
      width: LOGO_EDGE_PX,
      height: LOGO_EDGE_PX,
    });
  });

  it("kraća stranica pokriva krug, duža se ne seče pre vremena", () => {
    expect(logoTargetSize(1000, 300)).toEqual({ width: 960, height: 288 });
    expect(logoTargetSize(300, 1000)).toEqual({ width: 288, height: 960 });
  });

  it("manja slika se ne uvećava", () => {
    expect(logoTargetSize(200, 120)).toEqual({ width: 200, height: 120 });
  });
});
