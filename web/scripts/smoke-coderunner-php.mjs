// Smoke test the PHP path. Loads the PHP changeset (`?cs=cs-09`), replaces a
// diff line's text with the user's example `function ($a) { echo $a; }`,
// drives the panel, and verifies real PHP echoed `2`. Then dynamic-imports
// the runner modules directly to double-check the module-level result.

import { chromium } from "playwright-core";

const URL = process.env.URL || "http://localhost:5173/";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[page error]", e.message));
  // First: end-to-end UI test on the PHP changeset.
  await page.goto(URL + "?cs=cs-09");
  await page.waitForSelector(".diff");
  await page.keyboard.press("Escape").catch(() => {});

  const lineHandle = await page.waitForSelector(".diff .line .line__text");
  await page.evaluate((node) => {
    node.textContent = "function ($a) { echo $a; }";
    const sel = window.getSelection();
    sel?.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(node);
    sel?.addRange(range);
  }, lineHandle);

  const pillUi = await page.waitForSelector(".coderunner__pill", { timeout: 3000 });
  await pillUi.click();
  await page.waitForSelector(".coderunner__panel");
  const inputs = await page.$$(".coderunner__input-box");
  for (const i of inputs) await i.fill("2");
  await page.click(".coderunner__run");
  await page.waitForSelector(".coderunner__out", { timeout: 4000 });
  const uiOut = await page.textContent(".coderunner__out");
  console.log("ui output:", uiOut);
  if (!uiOut || !uiOut.includes("2")) {
    throw new Error(`Expected '2' in UI output, got: ${uiOut}`);
  }

  const result = await page.evaluate(async () => {
    const parseMod = await import("/src/runner/parseInputs.ts");
    const phpMod = await import("/src/runner/executePhp.ts");
    const parsed = parseMod.parseSelection("function ($a) { echo $a; }", "php");
    const r = await phpMod.runPhp(parsed, { a: "2" });
    return r;
  });
  console.log("result:", JSON.stringify(result));
  if (!result.ok) throw new Error("PHP run failed: " + result.error);
  // The user's example: echo $a with $a = 2 → stdout "2"
  if (!(result.logs || []).some((l) => l.includes("2"))) {
    throw new Error("Expected '2' in logs, got " + JSON.stringify(result.logs));
  }
  await browser.close();
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
