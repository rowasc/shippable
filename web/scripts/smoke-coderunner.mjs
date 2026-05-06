// Smoke test for the current CodeRunner UI.
//
// The old selection-pill flow is gone; the stable entrypoint is the topbar
// free runner. This smoke opens that panel, runs a trivial TS snippet, and
// asserts the output.

import { chromium } from "playwright-core";

const URL = process.env.URL || "http://localhost:5173/";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("console", (m) => console.log("[page]", m.type(), m.text()));
  page.on("pageerror", (e) => console.log("[page error]", e.message));

  await page.goto(URL);
  await page.waitForSelector(".diff");
  // Dismiss the plan overlay if present.
  await page.keyboard.press("Escape").catch(() => {});

  await page.click('button[title*="free code runner"]');
  await page.waitForSelector(
    ".coderunner__panel.coderunner--free, .coderunner--free .coderunner__panel",
    { timeout: 5000 },
  );

  await page.fill(".coderunner__source-edit", "(a) => a * 2");
  await page.waitForTimeout(100);
  await page.fill(".coderunner__input-box", "21");
  await page.click(".coderunner__run");
  await page.waitForSelector(".coderunner__out", { timeout: 4000 });

  const out = await page.textContent(".coderunner__out");
  console.log("output:", out);
  if (!out || !out.includes("42")) {
    throw new Error(`Expected output to include 42, got: ${out}`);
  }

  await browser.close();
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
