import { describe, expect, it } from "vitest";
import {
  cancelLink,
  isManageProof,
  MAX_REMEMBERED_PROOFS,
  newManageProof,
  parseProofs,
  proofFromFragment,
  serializeProofs,
  withProof,
} from "@/lib/domain/manage-proof";

const A = "A".repeat(43);
const B = "B".repeat(43);

function proofs(count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    String(index).padStart(43, "x"),
  );
}

describe("newManageProof", () => {
  it("pravi tajnu od 43 znaka koja prolazi proveru oblika", () => {
    const proof = newManageProof();

    expect(proof).not.toBeNull();
    expect(isManageProof(proof)).toBe(true);
  });

  it("dve tajne se ne ponavljaju", () => {
    const seen = new Set(Array.from({ length: 200 }, () => newManageProof()));

    expect(seen.size).toBe(200);
  });

  it("ne sadrži znakove koji smetaju u kolačiću i linku", () => {
    for (let index = 0; index < 200; index += 1) {
      expect(newManageProof()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });
});

describe("isManageProof", () => {
  it("odbija pogrešnu dužinu, znakove i tipove", () => {
    expect(isManageProof(A)).toBe(true);
    expect(isManageProof(A.slice(1))).toBe(false);
    expect(isManageProof(`${A}x`)).toBe(false);
    expect(isManageProof(`${A.slice(1)}=`)).toBe(false);
    expect(isManageProof(`${A.slice(1)}.`)).toBe(false);
    expect(isManageProof(null)).toBe(false);
    expect(isManageProof(undefined)).toBe(false);
    expect(isManageProof(42)).toBe(false);
  });
});

describe("parseProofs i serializeProofs", () => {
  it("čita ono što je upisano, istim redom", () => {
    expect(parseProofs(serializeProofs([A, B]))).toEqual([A, B]);
  });

  it("praznu i nedostajuću vrednost čita kao prazan spisak", () => {
    expect(parseProofs(undefined)).toEqual([]);
    expect(parseProofs("")).toEqual([]);
  });

  it("odbacuje sve što nije tajna", () => {
    expect(parseProofs(`smece.${A}..kratko.${B}`)).toEqual([A, B]);
  });

  it("spaja ponavljanja", () => {
    expect(parseProofs(`${A}.${A}.${B}`)).toEqual([A, B]);
  });

  it("ne vraća više tajni nego što kolačić sme da nosi", () => {
    const raw = serializeProofs(proofs(MAX_REMEMBERED_PROOFS + 4));

    expect(parseProofs(raw)).toHaveLength(MAX_REMEMBERED_PROOFS);
  });
});

describe("withProof", () => {
  it("stavlja novu tajnu na početak", () => {
    expect(withProof([A], B)).toEqual([B, A]);
  });

  it("ponovljena tajna ne ulazi dvaput nego prelazi na početak", () => {
    expect(withProof([A, B], B)).toEqual([B, A]);
  });

  it("kad je spisak pun ispada najstarija, a nova ostaje", () => {
    const full = proofs(MAX_REMEMBERED_PROOFS);
    const next = withProof(full, A);

    expect(next).toHaveLength(MAX_REMEMBERED_PROOFS);
    expect(next[0]).toBe(A);
    expect(next).not.toContain(full[MAX_REMEMBERED_PROOFS - 1]);
  });
});

describe("link i fragment", () => {
  it("tajna ide iza #, ne u upit", () => {
    const link = cancelLink("https://doteraj.me", "studio-milica", A);

    expect(link).toBe(`https://doteraj.me/studio-milica/otkazi#k=${A}`);
    expect(new URL(link).search).toBe("");
  });

  it("čita tajnu iz fragmenta koji je napravio cancelLink", () => {
    const link = cancelLink("https://doteraj.me", "studio-milica", A);

    expect(proofFromFragment(new URL(link).hash)).toBe(A);
  });

  it("fragment bez tajne ili sa pogrešnom tajnom daje null", () => {
    expect(proofFromFragment("")).toBeNull();
    expect(proofFromFragment("#")).toBeNull();
    expect(proofFromFragment("#k=kratko")).toBeNull();
    expect(proofFromFragment(`#x=${A}`)).toBeNull();
    expect(proofFromFragment(`#k=${A}x`)).toBeNull();
  });

  it("drugi parametri u fragmentu ne smetaju", () => {
    expect(proofFromFragment(`#utm=1&k=${A}`)).toBe(A);
  });
});
