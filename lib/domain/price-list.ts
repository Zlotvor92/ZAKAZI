export type PriceListImage = { src: string; alt: string };

/**
 * Cenovnik kao slike, samo za salone koji su ga poslali. Nije podešavanje u
 * aplikaciji: za sada ga ima jedan salon, pa je spisak upisan ovde, a slike
 * stoje u `public/cenovnik/<slug>/`.
 */
const priceLists: Record<string, readonly PriceListImage[]> = {
  "salon-smiley": [
    { src: "/cenovnik/salon-smiley/nokti.jpg", alt: "Cenovnik — nokti" },
    {
      src: "/cenovnik/salon-smiley/trepavice.jpg",
      alt: "Cenovnik — trepavice",
    },
    { src: "/cenovnik/salon-smiley/pedikir.jpg", alt: "Cenovnik — pedikir" },
  ],
};

export function priceListFor(slug: string): readonly PriceListImage[] | null {
  return Object.hasOwn(priceLists, slug) ? priceLists[slug]! : null;
}
