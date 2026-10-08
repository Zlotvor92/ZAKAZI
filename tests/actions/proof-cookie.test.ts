import { beforeEach, describe, expect, it, vi } from "vitest";

const { jar } = vi.hoisted(() => ({
  jar: {
    values: new Map<string, string>(),
    set: vi.fn(),
  },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.values.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: jar.set,
  }),
}));

import { readProofs, rememberProof } from "@/lib/proof-cookie";

const A = "A".repeat(43);
const B = "B".repeat(43);

beforeEach(() => {
  jar.values.clear();
  jar.set.mockReset();
});

describe("rememberProof", () => {
  it("postavlja httpOnly kolačić vezan za putanju salona", async () => {
    await rememberProof("studio-milica", A);

    expect(jar.set).toHaveBeenCalledTimes(1);
    const [name, value, options] = jar.set.mock.calls[0]!;
    expect(name).toBe("zakazi_termini");
    expect(value).toBe(A);
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/studio-milica",
    });
    expect(options.maxAge).toBeGreaterThan(90 * 24 * 60 * 60);
  });

  it("nova tajna ide ispred postojećih", async () => {
    jar.values.set("zakazi_termini", A);

    await rememberProof("studio-milica", B);

    expect(jar.set.mock.calls[0]![1]).toBe(`${B}.${A}`);
  });

  it("ista tajna ne ulazi dvaput", async () => {
    jar.values.set("zakazi_termini", `${A}.${B}`);

    await rememberProof("studio-milica", B);

    expect(jar.set.mock.calls[0]![1]).toBe(`${B}.${A}`);
  });

  it("sa pogrešnom oznakom salona ne postavlja ništa", async () => {
    for (const slug of ["", "Studio", "a/b", "a;b", "../x", "-a", "a b"]) {
      await rememberProof(slug, A);
    }

    expect(jar.set).not.toHaveBeenCalled();
  });
});

describe("readProofs", () => {
  it("čita samo ispravne tajne", async () => {
    jar.values.set("zakazi_termini", `smece.${A}`);

    expect(await readProofs()).toEqual([A]);
  });

  it("bez kolačića vraća prazan spisak", async () => {
    expect(await readProofs()).toEqual([]);
  });
});
