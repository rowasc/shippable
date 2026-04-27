// Verifies the JS sandbox actually blocks network exfiltration:
//   - fetch rejects (CSP `connect-src 'none'`).
//   - WebSocket / XHR / new Image fire `onerror` (sometimes throw, sometimes
//     async — we wait on the event so behavior is browser-stable).
//   - And ordinary JS still works.
//
// Note: sendBeacon's return value is "did we queue this", not "did CSP
// allow it" — it's not observable from inside the sandbox whether the
// request actually went out. We don't probe it here.
//
// Each probe is passed as an arrow-function expression so the runner's
// "anon-fn" wrapper provides an async scope (the "free" shape uses eval(),
// which can't host top-level await).

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
        src: "async () => new Promise(res => { const i = new Image(); i.onload = () => res('NO_BLOCK'); i.onerror = () => res('BLOCKED'); i.src = 'https://example.com/?leak'; setTimeout(() => res('TIMEOUT'), 1500); })",
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

  for (const n of ["fetch", "websocket", "xhr", "image"]) {
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
