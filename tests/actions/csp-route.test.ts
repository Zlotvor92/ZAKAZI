import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/errors", () => ({ logError }));

import { POST } from "@/app/api/csp/route";

function post(body: string): NextRequest {
  return new NextRequest("https://doterajme.test/api/csp", {
    method: "POST",
    body,
    headers: { "user-agent": "test-agent" },
  });
}

const legacy = {
  "csp-report": {
    "violated-directive": "img-src",
    "blocked-uri": "https://tudj.example/a.png?token=tajna",
    "document-uri": "https://doterajme.test/api/kalendar/salon/TOKEN.ics",
  },
};

beforeEach(() => logError.mockReset());

describe("POST /api/csp", () => {
  it("beleži izveštaj starog oblika, bez upita i tokena", async () => {
    const response = await POST(post(JSON.stringify(legacy)));

    expect(response.status).toBe(204);
    expect(logError).toHaveBeenCalledTimes(1);
    const message = logError.mock.calls[0]![0].message as string;
    expect(message).toContain("img-src");
    expect(message).not.toContain("tajna");
    expect(message).not.toContain("TOKEN");
  });

  it("beleži izveštaj novog oblika, samo csp-violation", async () => {
    const response = await POST(
      post(
        JSON.stringify([
          { type: "csp-violation", body: { effectiveDirective: "img-src" } },
          { type: "deprecation", body: {} },
        ]),
      ),
    );

    expect(response.status).toBe(204);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("ne upisuje Meta skriptu koju ubacuje Instagram pregledač", async () => {
    const response = await POST(
      post(
        JSON.stringify({
          "csp-report": {
            "violated-directive": "script-src-elem",
            "blocked-uri": "https://connect.facebook.net/en_US/pcm.js",
            "document-uri": "https://doterajme.test/salon",
          },
        }),
      ),
    );

    expect(response.status).toBe(204);
    expect(logError).not.toHaveBeenCalled();
  });

  it.each(["nije json", "{}", "[]", "null", '{"csp-report": 5}'])(
    "smeće (%s) daje 204 i ništa ne upisuje",
    async (body) => {
      const response = await POST(post(body));

      expect(response.status).toBe(204);
      expect(logError).not.toHaveBeenCalled();
    },
  );

  it("preveliko telo se ne obrađuje", async () => {
    const huge = JSON.stringify({
      "csp-report": { "violated-directive": "x".repeat(30_000) },
    });

    const response = await POST(post(huge));

    expect(response.status).toBe(204);
    expect(logError).not.toHaveBeenCalled();
  });

  it("jedan zahtev ne upisuje više od pet stavki", async () => {
    const many = Array.from({ length: 20 }, () => ({
      type: "csp-violation",
      body: { effectiveDirective: "img-src" },
    }));

    await POST(post(JSON.stringify(many)));

    expect(logError).toHaveBeenCalledTimes(5);
  });
});
