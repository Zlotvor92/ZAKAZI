// QA vozač: otvori stranice, snimi ekrane, prijavi šta je našao.
import { chromium, devices } from "@playwright/test";

export const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
export const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
export const BASE = "http://localhost:3000";

export async function launch(opts = MOBILE) {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await browser.newContext({ ...opts, locale: "sr-RS", timezoneId: "Europe/Belgrade" });
  return { browser, ctx };
}

/** Vodoravni skrol i mete manje od 44 px — dve provere koje se rade na svakom ekranu. */
export async function auditScreen(page) {
  return await page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const small = [];
    for (const el of document.querySelectorAll('button, a, input, select, textarea, [role="button"], label')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      if (r.height < 44 || r.width < 44) {
        small.push({ tag: el.tagName.toLowerCase(), text: (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
    return { overflowPx: overflow, scrollWidth: document.documentElement.scrollWidth, small };
  });
}

export async function shot(page, name) {
  await page.screenshot({ path: `qa/screenshots/${name}.png`, fullPage: true });
  return name;
}
