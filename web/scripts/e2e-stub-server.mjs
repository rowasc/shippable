#!/usr/bin/env node
// Tiny stub /api/* server for the e2e suite. The dev server's vite proxy
// forwards /api/* to :3001; this listener satisfies the boot probes
// (/api/health + /api/auth/list) so the app gets past `ServerHealthGate`
// without a real server. Individual tests override endpoints via
// `page.route()` — same pattern as the smokes.
//
// Anything not in the default set returns 503 so an unmocked call fails
// loud instead of hanging on a proxy timeout.

import { createServer } from "node:http";

function parsePort(argv) {
  const idx = argv.indexOf("--port");
  if (idx >= 0) {
    const port = Number.parseInt(argv[idx + 1], 10);
    if (!Number.isFinite(port)) throw new Error(`bad --port: ${argv[idx + 1]}`);
    return port;
  }
  return Number.parseInt(process.env.E2E_STUB_PORT ?? "3001", 10);
}

const port = parsePort(process.argv.slice(2));

const json = (res, status, body) => {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(body));
};

const server = createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    res.end();
    return;
  }
  const url = req.url ?? "";
  if (url === "/api/health") return json(res, 200, { ok: true });
  if (url === "/api/auth/list") return json(res, 200, { credentials: [] });
  if (url.startsWith("/api/prompts")) return json(res, 200, { prompts: [] });
  // Drain POST bodies so the client doesn't hang on backpressure.
  req.resume();
  json(res, 503, { error: `e2e stub: ${req.method} ${url} not mocked` });
});

server.on("listening", () => {
  console.log(`[e2e-stub] listening on :${port}`);
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    // playwright's `reuseExistingServer` flag handles this case — exit clean
    // so it falls through to the existing listener.
    console.log(`[e2e-stub] :${port} already in use; assuming it's another stub`);
    process.exit(0);
  }
  console.error("[e2e-stub] error", err);
  process.exit(1);
});
server.listen(port, "127.0.0.1");

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}
