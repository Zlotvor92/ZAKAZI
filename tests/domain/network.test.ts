import { beforeEach, describe, expect, it, vi } from "vitest";

const incoming = new Map<string, string>();

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (name: string) => incoming.get(name) ?? null }),
}));

import { networkHash } from "@/lib/network";

beforeEach(() => incoming.clear());

describe("networkHash", () => {
  it("računa se iz zaglavlja koje postavlja server, ne iz tela zahteva", async () => {
    incoming.set("x-forwarded-for", "203.0.113.9, 10.0.0.1");
    const first = await networkHash("salon-a");
    incoming.set("x-forwarded-for", "203.0.113.9");
    expect(await networkHash("salon-a")).toBe(first);
  });

  it("različita adresa daje drugi hash, isti salon", async () => {
    incoming.set("x-forwarded-for", "203.0.113.9");
    const first = await networkHash("salon-a");
    incoming.set("x-forwarded-for", "203.0.113.10");
    expect(await networkHash("salon-a")).not.toBe(first);
  });

  it("ista adresa u dva salona daje dva hash-a", async () => {
    incoming.set("x-forwarded-for", "203.0.113.9");
    expect(await networkHash("salon-a")).not.toBe(await networkHash("salon-b"));
  });

  it("bez adrese vraća null, ne zajedničku vrednost", async () => {
    expect(await networkHash("salon-a")).toBeNull();
  });

  it("ne sadrži samu adresu", async () => {
    incoming.set("x-forwarded-for", "203.0.113.9");
    expect(await networkHash("salon-a")).not.toContain("203.0.113.9");
  });
});
