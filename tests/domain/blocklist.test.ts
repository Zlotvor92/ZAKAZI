import { describe, expect, it } from "vitest";
import { withClientNames } from "@/lib/domain/blocklist";

describe("withClientNames", () => {
  it("dodaje ime klijentkinje sa istim brojem", () => {
    const result = withClientNames(
      [{ id: "1", phone_e164: "+381641303328" }],
      [
        { phone_e164: "+381641303328", name: "Nata" },
        { phone_e164: "+381645550099", name: "Druga" },
      ],
    );

    expect(result).toEqual([
      { id: "1", phone_e164: "+381641303328", client_name: "Nata" },
    ]);
  });

  it("broj bez klijentkinje dobija null, ne ime nekog drugog", () => {
    const result = withClientNames(
      [{ id: "1", phone_e164: "+381641000111" }],
      [{ phone_e164: "+381641303328", name: "Nata" }],
    );

    expect(result[0]!.client_name).toBeNull();
  });

  it("prazna lista ostaje prazna", () => {
    expect(withClientNames([], [])).toEqual([]);
  });
});
