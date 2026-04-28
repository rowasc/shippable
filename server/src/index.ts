import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { generatePlan } from "./plan.ts";
import type { ChangeSet } from "../../web/src/types.ts";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = "127.0.0.1";
const ALLOWED_ORIGINS = new Set(
  (process.env.SHIPPABLE_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => normalizeOrigin(origin))
    .filter((origin): origin is string => !!origin),
);

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "[server] ANTHROPIC_API_KEY is not set in the environment. See README — recommended path on macOS is `export ANTHROPIC_API_KEY=$(security find-generic-password -s anthropic-key-shippable -w)` before `npm run dev`.",
  );
  process.exit(1);
}

const server = createServer(async (req, res) => {
  try {
    const origin = normalizeOrigin(req.headers.origin);
    if (req.method === "OPTIONS") {
      if (!originAllowed(origin)) {
        res.writeHead(403).end();
        return;
      }
      writeCorsHeaders(res, origin);
      res.writeHead(204).end();
      return;
    }
    if (!originAllowed(origin)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "origin not allowed" }));
      return;
    }
    if (req.method === "POST" && req.url === "/api/plan") {
      return handlePlan(req, res, origin);
    }
    if (req.method === "GET" && req.url === "/api/health") {
      writeCorsHeaders(res, origin);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    writeCorsHeaders(res, origin);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  } catch (err) {
    console.error("[server] unhandled error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "internal server error" }));
    }
  }
});

async function handlePlan(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
) {
  const body = await readBody(req);
  let parsed: { changeset?: ChangeSet };
  try {
    parsed = JSON.parse(body);
  } catch {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid JSON body" }));
    return;
  }
  const cs = parsed.changeset;
  if (!cs || typeof cs !== "object" || !("files" in cs)) {
    writeCorsHeaders(res, origin);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "expected { changeset: ChangeSet }" }));
    return;
  }

  const started = Date.now();
  console.log(`[server] /api/plan cs=${cs.id} files=${cs.files.length}`);
  try {
    const plan = await generatePlan(cs);
    const ms = Date.now() - started;
    console.log(
      `[server]   → ok in ${ms}ms: ${plan.intent.length} claims, ${plan.entryPoints.length} entry points`,
    );
    writeCorsHeaders(res, origin);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ plan }));
  } catch (err) {
    const ms = Date.now() - started;
    console.error(`[server]   → err in ${ms}ms:`, err);
    const message = err instanceof Error ? err.message : String(err);
    writeCorsHeaders(res, origin);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return null;
  }
}

function originAllowed(origin: string | null): boolean {
  // Non-browser clients and the Vite dev proxy may send no Origin header.
  if (origin === null) return true;
  return ALLOWED_ORIGINS.has(origin);
}

function writeCorsHeaders(res: ServerResponse, origin: string | null) {
  if (!origin) return;
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
}

server.listen(PORT, HOST, () => {
  const allowed = ALLOWED_ORIGINS.size > 0 ? [...ALLOWED_ORIGINS].join(", ") : "(none)";
  console.log(`[server] listening on http://${HOST}:${PORT}`);
  console.log(`[server] allowed browser origins: ${allowed}`);
});
