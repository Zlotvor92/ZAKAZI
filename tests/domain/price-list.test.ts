import { describe, expect, it } from "vitest";
import { priceListFor } from "@/lib/domain/price-list";

describe("priceListFor", () => {
  it("returns the three images for Salon Smiley", () => {
    expect(priceListFor("salon-smiley")?.map((image) => image.src)).toEqual([
      "/cenovnik/salon-smiley/nokti.jpg",
      "/cenovnik/salon-smiley/trepavice.jpg",
      "/cenovnik/salon-smiley/pedikir.jpg",
    ]);
  });

  it("returns null for every other salon", () => {
    expect(priceListFor("salon-mars")).toBeNull();
    expect(priceListFor("toString")).toBeNull();
  });
});
