import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";
import {
  CSP_REPORT_PATH,
  securityHeaders,
} from "@/lib/domain/security-headers";

function headersOf(production: boolean, supabaseHost: string | null) {
  const [rule] = securityHeaders({ production, supabaseHost });
  return Object.fromEntries(
    (rule?.headers ?? []).map((header) => [header.key, header.value]),
  );
}

describe("securityHeaders", () => {
  it("svaki odgovor nosi osnovne zaštite", () => {
    const headers = headersOf(false, null);

    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
  });

  it("važe za sve putanje", () => {
    const [rule] = securityHeaders({ production: true, supabaseHost: null });

    expect(rule?.source).toBe("/:path*");
  });

  it("CSP je samo Report-Only, nikad blokirajući, i samo u produkciji", () => {
    const production = headersOf(true, "abc.supabase.co");
    const development = headersOf(false, "abc.supabase.co");

    expect(production["Content-Security-Policy-Report-Only"]).toBeDefined();
    expect(production["Content-Security-Policy"]).toBeUndefined();
    // Razvojni server koristi `eval` za osvežavanje; politika bi samo galamila.
    expect(development["Content-Security-Policy-Report-Only"]).toBeUndefined();
  });

  it("politika pušta slike samo sa Supabase hosta projekta, ne sa svih", () => {
    const csp = headersOf(true, "abc.supabase.co")[
      "Content-Security-Policy-Report-Only"
    ]!;

    expect(csp).toContain("img-src 'self' data: blob: https://abc.supabase.co");
    expect(csp).not.toContain("*.supabase.co");
  });

  it("bez poznatog hosta slike ostaju samo sa sopstvenog izvora", () => {
    const csp = headersOf(true, null)["Content-Security-Policy-Report-Only"]!;

    expect(csp).toContain("img-src 'self' data: blob:;");
  });

  it("zabranjuje dodatke, osnovnu adresu i slanje formi drugde, i javlja prekršaje", () => {
    const csp = headersOf(true, null)["Content-Security-Policy-Report-Only"]!;

    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain(`report-uri ${CSP_REPORT_PATH}`);
    expect(csp).not.toContain("unsafe-eval");
  });

  it("Next konfiguracija ih zaista vraća", async () => {
    const rules = await nextConfig.headers?.();

    expect(rules?.[0]?.headers.map((h) => h.key)).toContain(
      "X-Content-Type-Options",
    );
  });
});
