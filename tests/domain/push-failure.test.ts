import { describe, expect, it } from "vitest";
import { classifyPushFailure } from "@/lib/domain/push-failure";

function domError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe("classifyPushFailure", () => {
  it("AbortError je greška servisa za obaveštenja, ne odbijena dozvola", () => {
    const failure = classifyPushFailure(
      domError("AbortError", "Registration failed - push service error"),
    );

    expect(failure.kind).toBe("service");
    expect(failure.name).toBe("AbortError");
  });

  it("ostale greške ostaju „pregledač nije dozvolio“", () => {
    expect(
      classifyPushFailure(domError("NotAllowedError", "Permission denied")).kind,
    ).toBe("browser");
    expect(
      classifyPushFailure(domError("NotSupportedError", "x")).kind,
    ).toBe("browser");
  });

  it("u evidenciju ide i ime i poruka, jer samo ime ne razlikuje uzroke", () => {
    const { report } = classifyPushFailure(
      domError("AbortError", "Registration failed - push service error"),
    );

    expect(report).toContain("AbortError");
    expect(report).toContain("Registration failed - push service error");
  });

  it("greška koja nije Error se ne ruši i ide kao „browser“", () => {
    const failure = classifyPushFailure("nešto");

    expect(failure.kind).toBe("browser");
    expect(failure.name).toBe("");
    expect(failure.report).toContain("nešto");
  });

  it("izveštaj stane u limit rute za prijavu grešaka", () => {
    const { report } = classifyPushFailure(
      domError("AbortError", "x".repeat(2000)),
    );

    expect(report.length).toBeLessThanOrEqual(500);
  });
});
