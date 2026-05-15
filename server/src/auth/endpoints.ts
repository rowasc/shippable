// Handlers for /api/auth/{set,has,clear,list}. Generic over `Credential`;
// the store enforces the github host blocklist on the write boundary.

import type { IncomingMessage, ServerResponse } from "node:http";
import { writeJson, readJson } from "../http.ts";
import {
  clearCredential,
  listCredentials,
  setCredential,
} from "./store.ts";
import type { Credential } from "./credential.ts";

function parseCredential(raw: unknown): Credential | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (c.kind === "anthropic") return { kind: "anthropic" };
  if (c.kind === "github") {
    if (typeof c.host !== "string") return null;
    // Normalize at the HTTP boundary so the Credential carries the canonical
    // form throughout the request — including any error message — and
    // /api/auth/list (which reflects the encoded store key) matches what the
    // caller sent in.
    const host = c.host.trim().toLowerCase();
    if (host === "") return null;
    return { kind: "github", host };
  }
  return null;
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
