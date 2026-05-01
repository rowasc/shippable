// Theme-aware smoke for the markdown preview: cycles through every app theme
// (dark, light, dollhouse, dollhouseNoir) and confirms the preview's painted
// colors actually change in lockstep — i.e. the rescoping reads from
// <html data-color-scheme> and the surface tokens follow the active theme.
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:5174";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();

await page.goto(`${BASE}/?cs=72`, { waitUntil: "networkidle" });
await page.keyboard.press("Escape").catch(() => {});

await page.locator(".diff__mode-btn", { hasText: "Preview" }).click();
await page.waitForSelector(".md-preview .markdown-body", { timeout: 5000 });

const observed = [];
for (const themeId of ["dark", "light", "dollhouse", "dollhouseNoir"]) {
  // Drive the theme directly via the same hook the picker uses.
  await page.evaluate((id) => {
    window.localStorage.setItem("shippable:theme", id);
    // Trigger the theme application — easiest path is a full reload to make
    // sure we're observing what a fresh user would see.
  }, themeId);
  await page.reload({ waitUntil: "networkidle" });
  await page.keyboard.press("Escape").catch(() => {});
  await page.locator(".diff__mode-btn", { hasText: "Preview" }).click();
  await page.waitForSelector(".md-preview .markdown-body");

  const colors = await page.evaluate(() => {
    const html = document.documentElement;
    const body = document.querySelector(".md-preview .markdown-body");
    if (!body) return null;
    const cs = getComputedStyle(body);
    return {
      htmlScheme: html.dataset.colorScheme,
      htmlTheme: html.dataset.theme,
      // Computed background of the preview pane wrapper (.md-preview)
      paneBg: getComputedStyle(document.querySelector(".md-preview")).backgroundColor,
      bodyColor: cs.color,
    };
  });
  observed.push({ themeId, ...colors });
}

await browser.close();

// Sanity: htmlTheme should equal themeId; htmlScheme should be light/dark.
let ok = true;
for (const o of observed) {
  if (o.htmlTheme !== o.themeId) {
    console.error(`✗ ${o.themeId}: html data-theme is ${o.htmlTheme}`);
    ok = false;
  }
  if (o.htmlScheme !== "light" && o.htmlScheme !== "dark") {
    console.error(`✗ ${o.themeId}: html data-color-scheme is ${o.htmlScheme}`);
    ok = false;
  }
}
// Sanity: at least 3 of the 4 themes must produce distinct paneBg/bodyColor
// pairs. (dollhouse is light; light is light — they'll have the SAME
// data-color-scheme but DIFFERENT app tokens, so paneBg differs.)
const sigs = new Set(observed.map((o) => `${o.paneBg}|${o.bodyColor}`));
if (sigs.size < 3) {
  console.error(`✗ themes did not produce 3+ distinct surface signatures:`, observed);
  ok = false;
}

console.log(JSON.stringify(observed, null, 2));
if (!ok) process.exit(1);
console.log("md-preview theme smoke ✓");
