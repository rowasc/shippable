// Verifies the 2s timeout is real, not advisory. Runs a tight infinite loop
// inside the sandbox and asserts:
//   1. The runner returns within ~3s (the 2s limit + worker setup overhead).
//   2. The result reports "Timed out".
//   3. The page is still responsive after the timeout (no frozen tab).
//
// The previous architecture failed (1) and (3) — user code ran on the
// iframe's own thread, which the iframe shared with the parent's main
// thread, so the setTimeout callback that was supposed to fire the
// timeout was itself blocked. This test would have hung forever.

import { chromium } from "playwright-core";

const URL = process.env.URL || "http://localhost:5173/";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[page error]", e.message));
  await page.goto(URL);
  await page.waitForSelector(".diff");

  // Run a tight infinite loop and time how long the runner takes to return.
  const t0 = Date.now();
  const result = await page.evaluate(async () => {
    const { runJs } = await import("/src/runner/executeJs.ts");
    const parsed = {
      lang: "js",
      source: "() => { while (true) {} }",
      shape: { kind: "anon-fn", params: [] },
      slots: [],
    };
    return await runJs(parsed, {});
  });
  const elapsed = Date.now() - t0;
  console.log("infinite-loop result:", JSON.stringify(result));
  console.log("elapsed:", elapsed + "ms");

  if (result.ok) {
    throw new Error("expected timeout, got ok=true: " + JSON.stringify(result));
  }
  if (!/Timed out/i.test(result.error || "")) {
    throw new Error(`expected "Timed out" in error, got: ${result.error}`);
  }
  // Allow generous overhead for worker spawn + page.evaluate roundtrip.
  if (elapsed > 5000) {
    throw new Error(`runner took ${elapsed}ms — timeout is meant to fire at ~2000ms`);
  }
  if (elapsed < 1900) {
    throw new Error(`runner returned in ${elapsed}ms — too fast, the 2s timeout didn't actually wait`);
  }
  console.log("ok: infinite loop terminated within 2s timeout");

  // Page should still be responsive after a runaway run.
  const responsive = await page.evaluate(() => 1 + 1);
  if (responsive !== 2) {
    throw new Error("page is unresponsive after timeout");
  }

  // And we should be able to run something normal right after.
  const followup = await page.evaluate(async () => {
    const { runJs } = await import("/src/runner/executeJs.ts");
    return await runJs(
      {
        lang: "js",
        source: "() => 2 + 2",
        shape: { kind: "anon-fn", params: [] },
        slots: [],
      },
      {},
    );
  });
  if (followup.result !== "4") {
    throw new Error(`followup run failed: ${JSON.stringify(followup)}`);
  }
  console.log("ok: page responsive + subsequent run still works");

  await browser.close();
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
