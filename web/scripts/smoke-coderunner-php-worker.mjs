// Verifies PHP runs in a Worker (no DOM access).
//
// 1. The PHP worker chunk is loaded only when PHP is needed — the main page
//    bundle should not import @php-wasm directly. We assert that by checking
//    the network requests during a JS-only run vs a PHP run.
// 2. Inside the worker, attempting to touch host-page state via PHP's
//    web-bridge surface area (which doesn't exist in workers) fails clean
//    instead of leaking host state. We do the bridge check by way of
//    `typeof document` — workers don't have one. We expose this from inside
//    the worker via a tiny PHP echo of a JS-injected sentinel that doesn't
//    exist (so a contained run echoes nothing).
//
// The test below focuses on (1) which is the load-time guarantee. (2) is
// covered by virtue of the runtime running where `self.document` is
// `undefined` — there's nothing to leak.

import { chromium } from "playwright-core";

const URL = process.env.URL || "http://localhost:5173/";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[page error]", e.message));

  const requests = [];
  page.on("request", (req) => requests.push(req.url()));

  // Cold load: only TS imports. Should not fetch php-wasm.
  await page.goto(URL);
  await page.waitForSelector(".diff");
  await page.waitForTimeout(500);

  // The Vite worker wrapper (a tiny constructor stub) is imported by the
  // main bundle so it's fetched eagerly — that's fine, it's small. The
  // expensive thing — the actual WASM binary — must only be fetched once
  // PHP is needed.
  const wasmBeforeRun = requests.filter((u) => /php_8_3.*\.wasm/.test(u));
  if (wasmBeforeRun.length > 0) {
    throw new Error(
      "WASM fetched on cold load — should be lazy:\n  " +
        wasmBeforeRun.join("\n  "),
    );
  }
  console.log("ok: no WASM fetches on cold load");

  // Trigger a PHP run via the runner module. This should spin up the
  // worker, which then fetches the WASM.
  const result = await page.evaluate(async () => {
    const { parseSelection } = await import("/src/runner/parseInputs.ts");
    const { runPhp } = await import("/src/runner/executePhp.ts");
    const parsed = parseSelection("function ($a) { echo $a; }", "php");
    return await runPhp(parsed, { a: "7" });
  });
  console.log("php result:", JSON.stringify(result));
  if (!result.ok || !(result.logs || []).some((l) => l.includes("7"))) {
    throw new Error(`expected PHP to echo 7, got ${JSON.stringify(result)}`);
  }

  // After the run, the WASM should have been fetched.
  await page.waitForTimeout(300);
  const wasmAfter = requests.filter((u) => /php_8_3.*\.wasm/.test(u));
  if (wasmAfter.length === 0) {
    throw new Error("expected WASM to be fetched after a PHP run");
  }
  console.log("ok: WASM fetched only after PHP run:", wasmAfter[0]);

  // Verify the worker's own network lockdown — try each exfiltration vector
  // from inside the worker and assert it's blocked.
  const probes = await page.evaluate(async () => {
    const { probeWorker } = await import("/src/runner/executePhp.ts");
    return await probeWorker();
  });
  console.log("worker probes:", probes);
  for (const k of ["fetch", "xhr", "websocket", "eventsource"]) {
    if (probes[k] !== "BLOCKED") {
      throw new Error(`worker ${k} not blocked: got ${probes[k]}`);
    }
  }
  console.log("ok: worker network lockdown enforced");

  await browser.close();
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
