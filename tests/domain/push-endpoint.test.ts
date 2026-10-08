import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint } from "@/lib/domain/push-endpoint";

describe("isAllowedPushEndpoint", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc123",
    "https://fcm.googleapis.com/wp/abc123",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QKC1Muic0H7",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
    "https://db5p.notify.windows.com/w/?token=abc",
  ])("pušta pravi push servis: %s", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    ["proizvoljan host", "https://attacker.example.test/collect"],
    ["http umesto https", "http://fcm.googleapis.com/fcm/send/abc"],
    ["loopback", "https://localhost/x"],
    ["loopback po adresi", "https://127.0.0.1/x"],
    ["privatna adresa", "https://10.0.0.5/x"],
    ["privatna adresa 192.168", "https://192.168.1.1/x"],
    ["link-local metadata adresa", "https://169.254.169.254/latest/meta-data"],
    ["IPv6 loopback", "https://[::1]/x"],
    ["korisničko ime koje liči na Google", "https://fcm.googleapis.com@evil.test/x"],
    ["lozinka u adresi", "https://user:pass@fcm.googleapis.com/x"],
    ["drugi port", "https://fcm.googleapis.com:8443/x"],
    ["host kao poddomen tuđeg domena", "https://fcm.googleapis.com.evil.test/x"],
    ["Google u putanji", "https://evil.test/fcm.googleapis.com/x"],
    ["sufiks bez granice", "https://evilpush.apple.com.evil.test/x"],
    ["sam sufiks bez oznake", "https://push.apple.com/x"],
    ["lažna sličnost sufiksa", "https://xpush.apple.com/x"],
    ["poddomen sa donjom crtom", "https://a_b.push.apple.com/x"],
    ["nije adresa", "nije adresa"],
    ["prazno", ""],
    ["javascript šema", "javascript:alert(1)"],
  ])("odbija: %s", (_name, endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });

  it("ne razlikuje velika i mala slova u hostu, kao ni DNS", () => {
    expect(isAllowedPushEndpoint("https://FCM.GoogleAPIs.com/fcm/send/x")).toBe(
      true,
    );
  });
});
