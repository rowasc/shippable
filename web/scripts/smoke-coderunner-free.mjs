// Quick smoke for free-expression observability:
// - JS:  `a + 2` with a=20  → result 22, vars { a: 20 }
// - JS:  `a = a * 2; a + 1` with a=21 → result 43, vars { a: 42 }
// - PHP: `$a + 2` with a=20 → result 22, vars { a: 20 }
// - PHP: `$a = $a * 2; $a + 1` with a=21 → result 43, vars { a: 42 }

import { chromium } from "playwright-core";

const URL = process.env.URL || "http://localhost:5174/";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[page error]", e.message));
  await page.goto(URL);
  await page.waitForSelector(".diff");

  const result = await page.evaluate(async () => {
    const parseMod = await import("/src/runner/parseInputs.ts");
    const jsMod = await import("/src/runner/executeJs.ts");
    const phpMod = await import("/src/runner/executePhp.ts");

    const cases = [
      { lang: "ts", src: "a + 2", inputs: { a: "20" } },
      { lang: "ts", src: "a = a * 2; a + 1", inputs: { a: "21" } },
      { lang: "php", src: "$a + 2", inputs: { a: "20" } },
      { lang: "php", src: "$a = $a * 2; $a + 1", inputs: { a: "21" } },
    ];
    const results = [];
    for (const c of cases) {
      const parsed = parseMod.parseSelection(c.src, c.lang);
      const r =
        c.lang === "php"
          ? await phpMod.runPhp(parsed, c.inputs)
          : await jsMod.runJs(parsed, c.inputs);
      results.push({ src: c.src, lang: c.lang, ok: r.ok, result: r.result, vars: r.vars, error: r.error });
    }
    return results;
  });

  console.log(JSON.stringify(result, null, 2));

  for (const r of result) {
    if (!r.ok) throw new Error(`${r.lang} ${r.src} failed: ${r.error}`);
  }
  // Spot-check JS expressions.
  const js1 = result[0];
  if (js1.result !== "22") throw new Error("expected JS '22', got " + js1.result);
  if (!js1.vars || js1.vars.a !== "20") throw new Error("expected vars.a=20, got " + JSON.stringify(js1.vars));

  const js2 = result[1];
  if (js2.result !== "43") throw new Error("expected JS '43', got " + js2.result);
  if (!js2.vars || js2.vars.a !== "42") throw new Error("expected vars.a=42, got " + JSON.stringify(js2.vars));

  const php1 = result[2];
  if (php1.result !== "22") throw new Error("expected PHP '22', got " + php1.result);
  if (!php1.vars || php1.vars.a !== "20") throw new Error("expected PHP vars.a=20, got " + JSON.stringify(php1.vars));

  // PHP multi-statement: no completion-value, but vars snapshot still works.
  const php2 = result[3];
  if (!php2.vars || php2.vars.a !== "42") throw new Error("expected PHP vars.a=42, got " + JSON.stringify(php2.vars));

  await browser.close();
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
