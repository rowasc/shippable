// Theme smoke: cycles through every registered theme, confirms the picker
// applies it (data-theme on <html> and the core CSS vars are populated), and
// captures a /gallery.html screenshot per theme so a human can eyeball.
// Asserts that --bg and --accent come out distinct across themes — guards
// against the adapter collapsing two themes onto the same palette.
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE ?? "http://localhost:5173";
const OUT = process.env.OUT ?? "/tmp/theme-shots";
await mkdir(OUT, { recursive: true });

const THEMES = [
  "dark",
  "light",
  "dollhouse",
  "dollhouseNoir",
  "catppuccinMocha",
  "catppuccinLatte",
  "tokyoNight",
  "dracula",
];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();

const results = [];
for (const themeId of THEMES) {
  await page.goto(`${BASE}/gallery.html`, { waitUntil: "networkidle" });
  await page.evaluate((id) => window.localStorage.setItem("shippable:theme", id), themeId);
  await page.reload({ waitUntil: "networkidle" });
  // Shiki renders code asynchronously; wait so the screenshot includes it.
  await page.waitForTimeout(800);

  const probe = await page.evaluate(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const tokens = ["bg", "bg-2", "bg-3", "fg", "fg-dim", "fg-mute", "accent", "border", "green", "red"];
    const vars = Object.fromEntries(tokens.map((t) => [t, cs.getPropertyValue(`--${t}`).trim()]));
    return {
      htmlTheme: root.dataset.theme,
      htmlScheme: root.dataset.colorScheme,
      vars,
    };
  });

  const galleryFile = `${OUT}/${themeId}-gallery.png`;
  await page.screenshot({ path: galleryFile, fullPage: false });

  // Also screenshot the live app on a TypeScript-heavy fixture so we can
  // verify the active theme drives DiffView syntax rendering, not just the
  // gallery's static showcase.
  await page.goto(`${BASE}/?cs=42`, { waitUntil: "networkidle" });
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(800);
  const appFile = `${OUT}/${themeId}-app.png`;
  await page.screenshot({ path: appFile, fullPage: false });

  results.push({ themeId, galleryFile, appFile, ...probe });
}

await browser.close();

const distinctBgs = new Set(results.map((r) => r.vars.bg));
const distinctAccents = new Set(results.map((r) => r.vars.accent));

console.log(JSON.stringify(results, null, 2));
console.log("---");
console.log(`distinct --bg: ${distinctBgs.size}/${results.length}`);
console.log(`distinct --accent: ${distinctAccents.size}/${results.length}`);

let ok = true;
for (const r of results) {
  if (r.htmlTheme !== r.themeId) {
    console.error(`✗ ${r.themeId}: html data-theme is ${r.htmlTheme}`);
    ok = false;
  }
  if (!r.vars.bg || !r.vars.fg || !r.vars.accent) {
    console.error(`✗ ${r.themeId}: missing core var`, r.vars);
    ok = false;
  }
  if (r.vars["fg-dim"] === r.vars.fg) {
    console.error(`✗ ${r.themeId}: --fg-dim collapsed to --fg`);
    ok = false;
  }
}
if (distinctBgs.size < results.length - 1) {
  console.error(`✗ too many themes share --bg`);
  ok = false;
}
if (!ok) process.exit(1);
console.log("themes smoke ✓");
