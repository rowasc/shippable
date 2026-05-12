// Handlers for /api/auth/{set,has,clear,list}. Generic over `Credential`;
// the store enforces the github host blocklist on the write boundary.

import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody, writeCorsHeaders } from "../http.ts";
import {
  clearCredential,
  hasCredential,
  listCredentials,
  setCredential,
} from "./store.ts";
import type { Credential } from "./credential.ts";

function parseCredential(raw: unknown): Credential | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (c.kind === "anthropic") return { kind: "anthropic" };
  if (c.kind === "github") {
    if (typeof c.host !== "string" || c.host.trim() === "") return null;
    return { kind: "github", host: c.host };
  }
  return null;
}

function writeJson(
  res: ServerResponse,
  origin: string | null,
  status: number,
  body: unknown,
): void {
  writeCorsHeaders(res, origin);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const body = await readBody(req);
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export async function handleAuthSet(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
): Promise<void> {
  const parsed = (await readJson(req)) as
    | { credential?: unknown; value?: unknown }
    | null;
  if (!parsed || typeof parsed !== "object") {
    writeJson(res, origin, 400, { error: "invalid_credential" });
    return;
  }
  const credential = parseCredential(parsed.credential);
  if (!credential) {
    writeJson(res, origin, 400, { error: "invalid_credential" });
    return;
  }
  if (typeof parsed.value !== "string" || parsed.value === "") {
    writeJson(res, origin, 400, { error: "missing_value" });
    return;
  }
  try {
    setCredential(credential, parsed.value);
  } catch {
    // The only thing `setCredential` rejects today is a blocked github host.
    writeJson(res, origin, 400, { error: "host_blocked" });
    return;
  }
  writeJson(res, origin, 200, { ok: true });
}

export async function handleAuthHas(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
): Promise<void> {
  const parsed = (await readJson(req)) as
    | { credential?: unknown }
    | null;
  if (!parsed || typeof parsed !== "object") {
    writeJson(res, origin, 400, { error: "invalid_credential" });
    return;
  }
  const credential = parseCredential(parsed.credential);
  if (!credential) {
    writeJson(res, origin, 400, { error: "invalid_credential" });
    return;
  }
  writeJson(res, origin, 200, { present: hasCredential(credential) });
}

export async function handleAuthClear(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
): Promise<void> {
  const parsed = (await readJson(req)) as
    | { credential?: unknown }
    | null;
  if (!parsed || typeof parsed !== "object") {
    writeJson(res, origin, 400, { error: "invalid_credential" });
    return;
  }
  const credential = parseCredential(parsed.credential);
  if (!credential) {
    writeJson(res, origin, 400, { error: "invalid_credential" });
    return;
  }
  clearCredential(credential);
  writeJson(res, origin, 200, { ok: true });
}

export async function handleAuthList(
  _req: IncomingMessage,
  res: ServerResponse,
  origin: string | null,
): Promise<void> {
  writeJson(res, origin, 200, { credentials: listCredentials() });
}
