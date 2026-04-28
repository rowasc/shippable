import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { generatePlan } from "./plan.ts";
import type { ChangeSet } from "../../web/src/types.ts";

const PORT = Number(process.env.PORT ?? 3001);

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "[server] ANTHROPIC_API_KEY is not set in the environment. See README — recommended path on macOS is `export ANTHROPIC_API_KEY=$(security find-generic-password -s anthropic-key-shippable -w)` before `npm run dev`.",
  );
  process.exit(1);
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      writeCorsHeaders(res);
      res.writeHead(204).end();
      return;
    }
    if (req.method === "POST" && req.url === "/api/plan") {
      return handlePlan(req, res);
    }
    if (req.method === "GET" && req.url === "/api/health") {
      writeCorsHeaders(res);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    writeCorsHeaders(res);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  } catch (err) {
    console.error("[server] unhandled error:", err);
    if (!res.headersSent) {
      writeCorsHeaders(res);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "internal server error" }));
    }
  }
});

async function handlePlan(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req);
  let parsed: { changeset?: ChangeSet };
  try {
    parsed = JSON.parse(body);
  } catch {
    writeCorsHeaders(res);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid JSON body" }));
    return;
  }
  const cs = parsed.changeset;
  if (!cs || typeof cs !== "object" || !("files" in cs)) {
    writeCorsHeaders(res);
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
    writeCorsHeaders(res);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ plan }));
  } catch (err) {
    const ms = Date.now() - started;
    console.error(`[server]   → err in ${ms}ms:`, err);
    const message = err instanceof Error ? err.message : String(err);
    writeCorsHeaders(res);
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

function writeCorsHeaders(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
