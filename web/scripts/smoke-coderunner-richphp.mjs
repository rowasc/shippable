// Verifies the enriched cs-09 fixture is reachable via both URL forms and
// that selecting one of its functions (format_money) runs through real PHP.

import { chromium } from "playwright-core";

const URL = process.env.URL || "http://localhost:5173/";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[page error]", e.message));

  // Short URL — `?c=09` should resolve to cs-09.
  await page.goto(URL + "?c=09");
  await page.waitForSelector(".diff");
  const path = await page.textContent(".diff__path");
  if (!path || !path.includes("lib/money.php")) {
    throw new Error(`expected lib/money.php in topbar, got: ${path}`);
  }
  console.log("short-url cs-09 → diff path:", path.trim());

  // Run format_money(1234) end-to-end via the inline runner.
  const lineHandle = await page.waitForSelector(".diff .line .line__text");
  await page.evaluate((node) => {
    node.textContent = "function format_money($cents) { return '$' . number_format($cents / 100, 2); }";
    const sel = window.getSelection();
    sel?.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(node);
    sel?.addRange(range);
  }, lineHandle);
  await page.waitForSelector(".coderunner__pill", { timeout: 3000 });
  await page.click(".coderunner__pill");
  await page.waitForSelector(".coderunner__panel");
  await page.fill(".coderunner__input-box", "1234");
  await page.click(".coderunner__run");
  await page.waitForSelector(".coderunner__out", { timeout: 5000 });
  const out = await page.textContent(".coderunner__out");
  console.log("ran format_money(1234) →", out);
  if (!out || !out.includes("12.34")) {
    throw new Error(`expected '$12.34' in output, got: ${out}`);
  }

  await browser.close();
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
