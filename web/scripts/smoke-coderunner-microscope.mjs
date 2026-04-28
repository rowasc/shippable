// Verifies the new "microscope" fixtures actually let you observe the
// seeded bugs through the runner. Doesn't drive the UI — runs the runner
// modules directly with the same source you'd select in the diff.

import { chromium } from "playwright-core";

const URL = process.env.URL || "http://localhost:5173/";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[page error]", e.message));
  await page.goto(URL);
  await page.waitForSelector(".diff");

  const results = await page.evaluate(async () => {
    const { parseSelection } = await import("/src/runner/parseInputs.ts");
    const { runJs } = await import("/src/runner/executeJs.ts");
    async function run(src, inputs) {
      const parsed = parseSelection(src, "ts");
      return await runJs(parsed, inputs);
    }
    return {
      // cs-21 — number helpers
      clamp_normal: await run(
        "(value: number, min: number, max: number) => Math.min(Math.max(value, min), max)",
        { value: "150", min: "0", max: "100" },
      ),
      clamp_nan: await run(
        "(value: number, min: number, max: number) => Math.min(Math.max(value, min), max)",
        { value: "NaN", min: "0", max: "100" },
      ),
      maprange_zero: await run(
        "(value: number, fromMin: number, fromMax: number, toMin: number, toMax: number) => { const t = (value - fromMin) / (fromMax - fromMin); return toMin + (toMax - toMin) * t; }",
        { value: "5", fromMin: "0", fromMax: "0", toMin: "100", toMax: "200" },
      ),
      roundTo_bug: await run(
        "(value: number, increment: number) => Math.floor(value / increment) * increment",
        { value: "2.46", increment: "0.1" },
      ),

      // cs-31 — text helpers
      slugify_ascii: await run(
        "(text: string) => text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')",
        { text: "'Hello World!'" },
      ),
      slugify_unicode_bug: await run(
        "(text: string) => text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')",
        { text: "'Héllo Wörld 🎉'" },
      ),
      truncate_boundary: await run(
        "(text: string, max: number) => text.length <= max ? text : text.slice(0, max - 1) + '\\u2026'",
        { text: "'hello'", max: "5" },
      ),
    };
  });

  console.log(JSON.stringify(results, null, 2));

  // cs-21: probes that should reveal the seeded bugs
  if (results.clamp_normal.result !== "100") throw new Error("clamp_normal: " + results.clamp_normal.result);
  if (results.clamp_nan.result !== "null") throw new Error("clamp_nan should produce NaN (serialized as null), got: " + results.clamp_nan.result);
  if (results.maprange_zero.result !== "null") throw new Error("maprange_zero should produce NaN, got: " + results.maprange_zero.result);
  // The seeded bug — Math.floor truncates instead of rounding to nearest.
  // 2.46 / 0.1 = 24.6 → floor → 24 → * 0.1 = 2.4. So the runner exposes 2.4
  // instead of the 2.5 a reviewer would expect from "round to nearest".
  if (!results.roundTo_bug.result.startsWith("2.4")) {
    throw new Error("roundTo_bug should reveal floor-truncation behavior with result starting '2.4', got: " + results.roundTo_bug.result);
  }
  console.log("ok: cs-21 number-helper bugs observable through runner");

  // cs-31: ASCII slugify fine, unicode silently drops. The sandbox returns
  // string results unquoted (origin() passes strings through as-is).
  if (results.slugify_ascii.result !== "hello-world") throw new Error("slugify_ascii: " + results.slugify_ascii.result);
  if (results.slugify_unicode_bug.result !== "h-llo-w-rld") {
    throw new Error("slugify_unicode_bug should reveal the bug; got: " + results.slugify_unicode_bug.result);
  }
  if (results.truncate_boundary.result !== "hello") {
    throw new Error("truncate_boundary should pass through untouched; got: " + results.truncate_boundary.result);
  }
  console.log("ok: cs-31 text-helper bugs observable through runner");

  await browser.close();
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
