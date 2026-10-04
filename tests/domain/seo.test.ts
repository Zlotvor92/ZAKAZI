import { describe, expect, it } from "vitest";
import {
  salonDescription,
  salonJsonLd,
  serializeJsonLd,
  truncateAtWord,
} from "@/lib/domain/seo";

describe("truncateAtWord", () => {
  it("ostavlja kratak tekst netaknut", () => {
    expect(truncateAtWord("kratko", 20)).toBe("kratko");
  });

  it("seče na granici reči i ne prelazi ograničenje", () => {
    const out = truncateAtWord("jedan dva tri četiri pet šest", 16);
    expect(out.length).toBeLessThanOrEqual(16);
    expect(out).toBe("jedan dva tri…");
  });
});

describe("salonDescription", () => {
  it("navodi usluge i staje u 160 znakova", () => {
    const services = Array.from({ length: 30 }, (_, i) => `Usluga broj ${i}`);
    const out = salonDescription("Mila Nails", services);
    expect(out.startsWith("Mila Nails — zakažite termin online")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(160);
  });

  it("radi i bez usluga", () => {
    expect(salonDescription("Mila", [])).toBe(
      "Mila — zakažite termin online, bez dopisivanja.",
    );
  });
});

describe("serializeJsonLd", () => {
  it("ime salona ne može da zatvori script oznaku", () => {
    const out = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("<");
    expect(JSON.parse(out).name).toBe("</script><script>alert(1)</script>");
  });
});

describe("salonJsonLd", () => {
  it("izostavlja katalog i sliku kad ih nema", () => {
    const out = salonJsonLd({
      name: "Mila",
      slug: "mila",
      logoUrl: null,
      description: "d",
      services: [],
    });
    expect(out).not.toHaveProperty("image");
    expect(out).not.toHaveProperty("hasOfferCatalog");
    expect(out.url).toBe("https://doterajme.rs/mila");
  });

  it("cenu piše u dinarima", () => {
    const out = salonJsonLd({
      name: "Mila",
      slug: "mila",
      logoUrl: "https://x.rs/l.png",
      description: "d",
      services: [{ name: "Gel", description: null, priceRsd: 2400 }],
    });
    expect(out.hasOfferCatalog?.itemListElement[0]).toMatchObject({
      price: "2400",
      priceCurrency: "RSD",
    });
  });
});
