// Verifies the TS transpile path actually handles things the regex stripper
// couldn't. Each case selects code that the old regex would have mangled or
// failed on, runs it through the runner, and asserts the result.

import { chromium } from "playwright-core";

const URL = process.env.URL || "http://localhost:5173/";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[page error]", e.message));
  await page.goto(URL);
  await page.waitForSelector(".diff");

  const result = await page.evaluate(async () => {
    const { parseSelection } = await import("/src/runner/parseInputs.ts");
    const { runJs } = await import("/src/runner/executeJs.ts");
    const cases = [
      // Generic param + return type — regex stripper would have mauled the <T>.
      {
        name: "generic-named",
        src: "function id<T>(x: T): T { return x; }",
        inputs: { x: "42" },
        expect: "42",
      },
      // Default param values + complex types in an arrow.
      {
        name: "default-param",
        src: "(a: number = 0, b: number = 0): number => a + b",
        inputs: { a: "20", b: "22" },
        expect: "42",
      },
      // Type assertion (`as`) the regex would only sometimes catch.
      {
        name: "as-cast",
        src: "(x: unknown) => (x as number) * 2",
        inputs: { x: "21" },
        expect: "42",
      },
      // Non-null assertion `!`.
      {
        name: "nonnull",
        src: "(x: number | null) => x! + 1",
        inputs: { x: "41" },
        expect: "42",
      },
    ];
    const results = [];
    for (const c of cases) {
      const parsed = parseSelection(c.src, "ts");
      const r = await runJs(parsed, c.inputs);
      results.push({ name: c.name, src: c.src, shape: parsed.shape, slots: parsed.slots, ok: r.ok, result: r.result, error: r.error });
    }
    return results;
  });

  console.log(JSON.stringify(result, null, 2));

  for (const r of result) {
    if (!r.ok) throw new Error(`${r.name}: ${r.error}`);
    if (r.result !== "42") {
      throw new Error(`${r.name}: expected 42, got ${r.result}`);
    }
  }

  // Lockdown probes — same shape as the PHP worker test.
  const probes = await page.evaluate(async () => {
    const { probeTsWorker } = await import("/src/runner/executeJs.ts");
    return await probeTsWorker();
  });
  console.log("ts-worker probes:", probes);
  for (const k of ["fetch", "xhr", "websocket", "eventsource", "subworker"]) {
    if (probes[k] !== "BLOCKED") throw new Error(`ts-worker ${k} not blocked: ${probes[k]}`);
  }
  console.log("ok: ts-worker network lockdown enforced");

  await browser.close();
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
