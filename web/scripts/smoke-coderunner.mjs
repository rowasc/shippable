// Smoke test for the CodeRunner prototype.
//
// Boots Chrome via playwright-core, opens the dev server (assumed running on
// http://localhost:5173), selects a TS function, runs it with an input, and
// asserts the output. Exits non-zero on failure.

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

  // Inject a known arrow function into the first diff line and select it.
  // Synthetic: avoids depending on the fixture having a self-contained
  // runnable function on a single line.
  const lineHandle = await page.waitForSelector(".diff .line .line__text");
  const selectedText = await page.evaluate((node) => {
    node.textContent = "(a) => a * 2";
    const sel = window.getSelection();
    sel?.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(node);
    sel?.addRange(range);
    return node.textContent;
  }, lineHandle);
  console.log("selected:", JSON.stringify(selectedText));

  // The pill should appear.
  const pill = await page.waitForSelector(".coderunner__pill", { timeout: 3000 });
  console.log("pill text:", await pill.textContent());

  // Click into the panel.
  await pill.click();
  await page.waitForSelector(".coderunner__panel", { timeout: 5000 });

  // Fill any inputs with sane values, then run.
  const inputs = await page.$$(".coderunner__input-box");
  for (const i of inputs) await i.fill("21");
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
