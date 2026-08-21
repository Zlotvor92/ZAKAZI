import { describe, expect, it } from "vitest";
import {
  tokenIssuedInFuture,
  withClockSkewRetry,
} from "@/lib/supabase/clock-skew";

/** Odgovor kojim PostgREST odbija token izdat ispred svog sata. */
function issuedInFuture(): Response {
  return new Response(
    JSON.stringify({ code: "PGRST303", message: "JWT issued at future" }),
    { status: 401 },
  );
}

function expired(): Response {
  return new Response(JSON.stringify({ message: "JWT expired" }), {
    status: 401,
  });
}

function ok(body = '{"data":1}'): Response {
  return new Response(body, { status: 200 });
}

/** `fetch` koji redom vraća zadate odgovore i broji pozive. */
function fetchReturning(responses: Response[]) {
  const calls: number[] = [];

  const impl: typeof fetch = async () => {
    const next = responses[calls.length];
    if (next === undefined) {
      throw new Error(`Nenajavljen poziv broj ${calls.length + 1}`);
    }
    calls.push(1);
    return next;
  };

  return { fetch: impl, count: () => calls.length };
}

describe("prepoznavanje odbijenog tokena", () => {
  it("hvata token izdat ispred sata PostgREST-a", () => {
    expect(tokenIssuedInFuture(401, "JWT issued at future")).toBe(true);
    expect(
      tokenIssuedInFuture(401, '{"message":"JWT issued at future"}'),
    ).toBe(true);
  });

  it("ne dira ostale razloge za 401", () => {
    expect(tokenIssuedInFuture(401, '{"message":"JWT expired"}')).toBe(false);
    expect(tokenIssuedInFuture(401, '{"message":"JWSError"}')).toBe(false);
  });

  it("gleda i status, ne samo poruku", () => {
    expect(tokenIssuedInFuture(200, "JWT issued at future")).toBe(false);
    expect(tokenIssuedInFuture(403, "JWT issued at future")).toBe(false);
  });
});

describe("čekanje na zaostao sat", () => {
  it("ponavlja dok token ne prođe", async () => {
    const inner = fetchReturning([issuedInFuture(), issuedInFuture(), ok()]);
    const retrying = withClockSkewRetry(inner.fetch, [0, 0, 0]);

    const response = await retrying("https://baza.test");

    expect(response.status).toBe(200);
    expect(inner.count()).toBe(3);
  });

  it("ne ponavlja odgovor koji je prošao", async () => {
    const inner = fetchReturning([ok()]);
    const retrying = withClockSkewRetry(inner.fetch, [0, 0]);

    await retrying("https://baza.test");

    expect(inner.count()).toBe(1);
  });

  it("ne ponavlja istekao token — čekanje ga ne bi popravilo", async () => {
    const inner = fetchReturning([expired()]);
    const retrying = withClockSkewRetry(inner.fetch, [0, 0]);

    const response = await retrying("https://baza.test");

    expect(response.status).toBe(401);
    expect(inner.count()).toBe(1);
  });

  it("odustaje posle poslednje pauze i vraća poslednji odgovor", async () => {
    const inner = fetchReturning([
      issuedInFuture(),
      issuedInFuture(),
      issuedInFuture(),
    ]);
    const retrying = withClockSkewRetry(inner.fetch, [0, 0]);

    const response = await retrying("https://baza.test");

    expect(response.status).toBe(401);
    expect(inner.count()).toBe(3);
  });

  // Provera se radi nad kopijom tela; da se čita original, pozivalac bi dobio
  // odgovor iz kog više ništa ne može da pročita.
  it("prosleđeni odgovor i dalje ima telo", async () => {
    const inner = fetchReturning([issuedInFuture(), ok('{"data":42}')]);
    const retrying = withClockSkewRetry(inner.fetch, [0]);

    const response = await retrying("https://baza.test");

    expect(await response.text()).toBe('{"data":42}');
  });

  it("odbijeni odgovor koji se ne ponavlja i dalje ima telo", async () => {
    const inner = fetchReturning([expired()]);
    const retrying = withClockSkewRetry(inner.fetch, [0]);

    const response = await retrying("https://baza.test");

    expect(await response.text()).toContain("JWT expired");
  });
});
