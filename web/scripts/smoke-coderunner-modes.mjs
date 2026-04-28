// Verifies the two new variants of the runner panel:
//
//   1. "Guided" mode (default after clicking the pill): source is read-only;
//      input fields show smart placeholders derived from the param name.
//   2. "Edit" mode: source is editable; changes re-derive the input slots
//      and update placeholders accordingly. Cmd/Ctrl+Enter runs.
//   3. Free runner: opening the panel via the topbar `▷ run` button works
//      with no diff selection, defaults to edit mode + an empty editor.

import { chromium } from "playwright-core";

const URL = process.env.URL || "http://localhost:5173/";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[page error]", e.message));

  // --- Guided mode -----------------------------------------------------
  await page.goto(URL);
  await page.waitForSelector(".diff");
  await page.keyboard.press("Escape").catch(() => {});

  const lineHandle = await page.waitForSelector(".diff .line .line__text");
  await page.evaluate((node) => {
    node.textContent = "function format_money(cents) { return cents; }";
    const sel = window.getSelection();
    sel?.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(node);
    sel?.addRange(range);
  }, lineHandle);
  await page.waitForSelector(".coderunner__pill");
  await page.click(".coderunner__pill");
  await page.waitForSelector(".coderunner__panel");

  // Mode tabs visible, "guided" active by default.
  const guidedActive = await page.evaluate(() =>
    document.querySelector('.coderunner__mode[aria-selected="true"]')?.textContent,
  );
  if (guidedActive?.trim() !== "guided") {
    throw new Error(`expected guided active, got ${guidedActive}`);
  }
  // Source is read-only (.coderunner__source-view), no textarea.
  const hasReadonlySource = await page.evaluate(() =>
    !!document.querySelector(".coderunner__source-view"),
  );
  if (!hasReadonlySource) throw new Error("guided mode missing read-only source");
  // Input placeholder derived from `cents` slot: should hint a number.
  const placeholder = await page.evaluate(() =>
    document.querySelector(".coderunner__input-box")?.getAttribute("placeholder"),
  );
  if (!placeholder || !/42/.test(placeholder)) {
    throw new Error(`expected numeric placeholder for $cents, got ${placeholder}`);
  }
  console.log("ok: guided mode + smart placeholder");

  // --- Switch to edit mode --------------------------------------------
  await page.click('.coderunner__mode:not(.coderunner__mode--on)');
  await page.waitForSelector(".coderunner__source-edit");
  // The textarea contains the original snippet.
  const initialSrc = await page.inputValue(".coderunner__source-edit");
  if (!initialSrc.includes("format_money")) {
    throw new Error(`edit textarea missing source: ${initialSrc}`);
  }
  console.log("ok: edit mode shows source in textarea");

  // Edit the source — change the parameter name; slots should re-derive.
  await page.fill(
    ".coderunner__source-edit",
    "function format_money(amount) { return amount * 2; }",
  );
  // Wait a tick for the parse → slot update to render.
  await page.waitForTimeout(100);
  const newSlotName = await page.evaluate(() =>
    document.querySelector(".coderunner__input-name")?.textContent,
  );
  if (!newSlotName || !newSlotName.includes("amount")) {
    throw new Error(`expected slot to update to $amount, got ${newSlotName}`);
  }
  console.log("ok: editing source re-derives input slots");

  // Fill input + run.
  await page.fill(".coderunner__input-box", "21");
  await page.click(".coderunner__run");
  await page.waitForSelector(".coderunner__out", { timeout: 8000 });
  const out = await page.textContent(".coderunner__out");
  if (!out || !out.includes("42")) {
    throw new Error(`expected '42' in output, got: ${out}`);
  }
  console.log("ok: edited source runs end-to-end");

  // Close.
  await page.click(".coderunner__close");
  await page.waitForSelector(".coderunner__panel", { state: "detached" });

  // --- Free runner via topbar button ----------------------------------
  // The topbar button has title containing "free code runner".
  await page.click('button[title*="free code runner"]');
  await page.waitForSelector(".coderunner__panel.coderunner--free, .coderunner--free .coderunner__panel");

  // Free runner defaults to edit mode.
  const editActive = await page.evaluate(() =>
    document.querySelector('.coderunner__mode[aria-selected="true"]')?.textContent,
  );
  if (editActive?.trim() !== "edit") {
    throw new Error(`free runner should default to edit mode, got ${editActive}`);
  }
  // Type a snippet and run.
  await page.fill(".coderunner__source-edit", "(a) => a + 1");
  await page.waitForTimeout(100);
  await page.fill(".coderunner__input-box", "41");
  await page.click(".coderunner__run");
  await page.waitForSelector(".coderunner__out", { timeout: 8000 });
  const freeOut = await page.textContent(".coderunner__out");
  if (!freeOut || !freeOut.includes("42")) {
    throw new Error(`free runner expected '42', got: ${freeOut}`);
  }
  console.log("ok: free runner via topbar button works");

  await browser.close();
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
