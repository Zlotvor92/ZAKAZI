import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type SetAll = (
  cookies: { name: string; value: string; options: Record<string, unknown> }[],
  headers: Record<string, string>,
) => void;

const state = vi.hoisted(() => ({
  claims: null as Record<string, unknown> | null,
  /** Šta `getClaims` upiše u odgovor dok osvežava ili briše sesiju. */
  cookies: [] as {
    name: string;
    value: string;
    options: Record<string, unknown>;
  }[],
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    config: { cookies: { setAll: SetAll } },
  ) => ({
    auth: {
      getClaims: async () => {
        if (state.cookies.length > 0) {
          config.cookies.setAll(state.cookies, {
            "Cache-Control": "private, no-cache, no-store",
          });
        }
        return { data: state.claims ? { claims: state.claims } : null };
      },
    },
  }),
}));

import { updateSession } from "@/lib/supabase/middleware";

function request(pathname: string): NextRequest {
  return new NextRequest(`https://doterajme.test${pathname}`);
}

const refreshed = {
  name: "sb-projekat-auth-token",
  value: "novi-token",
  options: { path: "/", maxAge: 400 * 24 * 60 * 60, httpOnly: false },
};

beforeEach(() => {
  process.env["NEXT_PUBLIC_SUPABASE_URL"] = "https://projekat.supabase.co";
  process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] = "anon";
  state.claims = null;
  state.cookies = [];
});

describe("updateSession: osvežen kolačić preživljava preusmeravanje", () => {
  it.each(["/", "/prijava"])(
    "prijavljenu vlasnicu sa %s vodi na kalendar i čuva nove tokene",
    async (pathname) => {
      state.claims = { sub: "korisnik" };
      state.cookies = [refreshed];

      const response = await updateSession(request(pathname));

      expect(response.headers.get("location")).toBe(
        "https://doterajme.test/dashboard",
      );
      expect(response.cookies.get(refreshed.name)?.value).toBe("novi-token");
      expect(response.headers.get("set-cookie")).toContain(
        `${refreshed.name}=novi-token`,
      );
      expect(response.headers.get("cache-control")).toBe(
        "private, no-cache, no-store",
      );
    },
  );

  it("odjavljenog sa /dashboard vodi na prijavu i prenosi brisanje kolačića", async () => {
    state.claims = null;
    state.cookies = [
      { name: refreshed.name, value: "", options: { path: "/", maxAge: 0 } },
    ];

    const response = await updateSession(request("/dashboard"));

    expect(response.headers.get("location")).toBe(
      "https://doterajme.test/prijava",
    );
    expect(response.headers.get("set-cookie")).toContain(`${refreshed.name}=;`);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("kontrola: bez preusmeravanja kolačić ostaje na odgovoru kao i do sada", async () => {
    state.claims = { sub: "korisnik" };
    state.cookies = [refreshed];

    const response = await updateSession(request("/dashboard"));

    expect(response.headers.get("location")).toBeNull();
    expect(response.cookies.get(refreshed.name)?.value).toBe("novi-token");
  });

  it("bez osvežavanja preusmeravanje ne dodaje kolačiće ni zaglavlja", async () => {
    state.claims = { sub: "korisnik" };

    const response = await updateSession(request("/prijava"));

    expect(response.headers.get("location")).toBe(
      "https://doterajme.test/dashboard",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBeNull();
  });
});
