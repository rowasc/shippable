import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { generatePlan } from "./plan.ts";
import type { ChangeSet } from "../../web/src/types.ts";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = "127.0.0.1";
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];
const ALLOWED_ORIGINS = loadAllowedOrigins();

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "[server] ANTHROPIC_API_KEY is not set in the environment. See README — recommended path on macOS is `export ANTHROPIC_API_KEY=$(security find-generic-password -s anthropic-key-shippable -w)` before `npm run dev`.",
  );
  process.exit(1);
}

const server = createServer(async (req, res) => {
  try {
    const check = classifyRequestOrigin(req.headers.origin);
    const fetchSite = classifyFetchSite(req.headers["sec-fetch-site"]);
    const origin = check.kind === "value" ? check.origin : null;
    if (req.method === "OPTIONS") {
      if (!isRequestAllowed(check, fetchSite)) {
        res.writeHead(403).end();
        return;
      }
      writeCorsHeaders(res, origin);
      res.writeHead(204).end();
      return;
    }
    if (!isRequestAllowed(check, fetchSite)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "request not allowed" }));
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

function parseOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function loadAllowedOrigins(): Set<string> {
  const configured = process.env.SHIPPABLE_ALLOWED_ORIGINS;
  const source =
    configured === undefined
      ? DEFAULT_ALLOWED_ORIGINS
      : configured.split(",");
  return new Set(
    source
      .map((origin) => parseOrigin(origin.trim()))
      .filter((origin): origin is string => !!origin),
  );
}

type OriginCheck =
  | { kind: "absent" }
  | { kind: "opaque" }
  | { kind: "value"; origin: string };

function classifyRequestOrigin(value: string | undefined): OriginCheck {
  // "absent": no Origin header — non-browser caller (curl, Vite dev proxy).
  // "opaque": header present but unparseable, including the literal string
  //   "null" that browsers send from sandboxed iframes, data: URLs, and some
  //   cross-origin redirects. Must be denied — collapsing this to "absent"
  //   is a CSRF hole (see git history for the exploit).
  // "value": parseable origin; check against the allowlist.
  if (value === undefined) return { kind: "absent" };
  const parsed = parseOrigin(value);
  return parsed === null
    ? { kind: "opaque" }
    : { kind: "value", origin: parsed };
}

type FetchSite = "same-origin" | "same-site" | "cross-site" | "none";

function classifyFetchSite(
  value: string | string[] | undefined,
): FetchSite | null {
  if (
    value === "same-origin" ||
    value === "same-site" ||
    value === "cross-site" ||
    value === "none"
  ) {
    return value;
  }
  return null;
}

function isRequestAllowed(
  check: OriginCheck,
  fetchSite: FetchSite | null,
): boolean {
  // Browser requests that present an Origin header must always match the
  // explicit allowlist. `Sec-Fetch-Site` is only an extra deny signal; it is
  // never enough on its own to broaden the allowlist.
  if (check.kind === "value") {
    return ALLOWED_ORIGINS.has(check.origin);
  }
  // Opaque origins (`Origin: null`, sandboxed iframes, data: URLs, some
  // redirects) are always denied.
  if (check.kind === "opaque") {
    return false;
  }
  // No Origin header: allow non-browser callers (curl, the Vite dev proxy).
  // If a browser somehow reports this as cross-site, deny it anyway.
  if (fetchSite === "cross-site") {
    return false;
  }
  // Otherwise this is either a non-browser caller or a legacy browser that
  // didn't send enough fetch metadata to classify further.
  switch (check.kind) {
    case "absent":
      return true;
  }
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
