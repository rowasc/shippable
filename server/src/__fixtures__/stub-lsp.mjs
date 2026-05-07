#!/usr/bin/env node
// Stub LSP server for unit tests. Real subprocess, real JSON-RPC framing,
// canned responses. Shared between definitions and code-graph tests so the
// wire-level behaviour (initialize handshake, didOpen ordering, request id
// correlation, concurrent in-flight requests) is exercised — only the
// indexer's *answers* are controlled.
//
// Configuration is read from JSON at the path passed via `--config`.
// Per-request stats are appended to `--stats` (one JSON object per line,
// atomic via O_APPEND) when supplied.
//
// Config shape:
//   {
//     "advertise": {
//       "documentSymbolProvider": true,
//       "referencesProvider": true,
//       "definitionProvider": true
//     },
//     "responseDelayMs": 0,
//     "documentSymbol": {
//        "<absolute-file-path>": [<DocumentSymbol[]>]
//     },
//     "references": {
//        "<absolute-file-path>:<line>:<col>": [<Location[]>]
//     },
//     "definition": {
//        "<absolute-file-path>:<line>:<col>": [<Location[]>]
//     }
//   }
//
// Anything not in `advertise` defaults to false. Unknown methods get a
// `MethodNotFound` error. Missing canned responses for a method we *do*
// advertise return an empty array.

import fs from "node:fs";

const argv = process.argv.slice(2);
function argFor(flag) {
  const idx = argv.indexOf(flag);
  if (idx < 0 || idx + 1 >= argv.length) return null;
  return argv[idx + 1];
}
const configPath = argFor("--config");
const statsPath = argFor("--stats");
if (!configPath) {
  process.stderr.write("stub-lsp: --config <path> is required\n");
  process.exit(2);
}
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

const advertise = config.advertise ?? {};
const delayMs = Number(config.responseDelayMs ?? 0);
const cannedDocumentSymbol = config.documentSymbol ?? {};
const cannedReferences = config.references ?? {};
const cannedDefinition = config.definition ?? {};

const counts = Object.create(null);

function recordStat(method) {
  counts[method] = (counts[method] ?? 0) + 1;
  if (!statsPath) return;
  const line = JSON.stringify({ method, at: Date.now(), counts: { ...counts } }) + "\n";
  // O_APPEND keeps writes from interleaving badly enough to corrupt JSON
  // lines under the loads tests put on the stub.
  fs.appendFileSync(statsPath, line);
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const m = /content-length:\s*(\d+)/i.exec(header);
    if (!m) {
      process.stderr.write(`stub-lsp: bad header: ${header}\n`);
      process.exit(3);
    }
    const len = Number(m[1]);
    const total = headerEnd + 4 + len;
    if (buffer.length < total) return;
    const body = buffer.slice(headerEnd + 4, total).toString("utf8");
    buffer = buffer.slice(total);
    handleMessage(body);
  }
});

function fileUriToPath(uri) {
  if (typeof uri !== "string" || !uri.startsWith("file://")) return uri ?? "";
  return decodeURIComponent(uri.slice("file://".length));
}

function send(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
  process.stdout.write(Buffer.concat([header, body]));
}

function handleMessage(body) {
  let msg;
  try {
    msg = JSON.parse(body);
  } catch (err) {
    process.stderr.write(`stub-lsp: bad JSON: ${err.message}\n`);
    return;
  }
  if (typeof msg.id !== "number" && typeof msg.id !== "string") {
    // Notification — record but don't respond.
    recordStat(msg.method);
    if (msg.method === "exit") process.exit(0);
    return;
  }
  recordStat(msg.method);
  Promise.resolve()
    .then(() => respond(msg))
    .then((result) => {
      if (delayMs > 0) {
        return new Promise((r) => setTimeout(() => r(result), delayMs));
      }
      return result;
    })
    .then((result) => {
      send({ jsonrpc: "2.0", id: msg.id, ...result });
    })
    .catch((err) => {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32603, message: String(err?.message ?? err) },
      });
    });
}

function respond(msg) {
  const m = msg.method;
  const params = msg.params ?? {};
  if (m === "initialize") {
    return {
      result: {
        capabilities: {
          documentSymbolProvider: !!advertise.documentSymbolProvider,
          referencesProvider: !!advertise.referencesProvider,
          definitionProvider: !!advertise.definitionProvider,
          textDocumentSync: 1,
        },
      },
    };
  }
  if (m === "shutdown") return { result: null };
  if (m === "textDocument/documentSymbol") {
    const filePath = fileUriToPath(params.textDocument?.uri);
    return { result: cannedDocumentSymbol[filePath] ?? [] };
  }
  if (m === "textDocument/references") {
    const filePath = fileUriToPath(params.textDocument?.uri);
    const key = `${filePath}:${params.position?.line ?? 0}:${params.position?.character ?? 0}`;
    return { result: cannedReferences[key] ?? [] };
  }
  if (m === "textDocument/definition") {
    const filePath = fileUriToPath(params.textDocument?.uri);
    const key = `${filePath}:${params.position?.line ?? 0}:${params.position?.character ?? 0}`;
    return { result: cannedDefinition[key] ?? [] };
  }
  return {
    error: { code: -32601, message: `MethodNotFound: ${m}` },
  };
}

process.stdin.on("end", () => process.exit(0));
