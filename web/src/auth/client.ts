// Thin fetch wrappers over /api/auth/{set,has,clear,list}. Non-2xx responses
// throw `AuthClientError` carrying the server's discriminator so callers can
// branch on `discriminator` instead of parsing status codes — mirrors
// `githubPrClient.GithubFetchError`.

import { apiUrl } from "../apiUrl";
import type { Credential } from "./credential";

export class AuthClientError extends Error {
  discriminator: string;

  constructor(discriminator: string, message?: string) {
    super(message ?? discriminator);
    this.name = "AuthClientError";
    this.discriminator = discriminator;
  }
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(await apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new AuthClientError(
      "unknown",
      err instanceof Error ? err.message : "Network error",
    );
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const discriminator =
      typeof json.error === "string" ? json.error : "unknown";
    throw new AuthClientError(discriminator);
  }
  return json;
}

export async function authSet(credential: Credential, value: string): Promise<void> {
  await postJson("/api/auth/set", { credential, value });
}

export async function authHas(credential: Credential): Promise<boolean> {
  const json = (await postJson("/api/auth/has", { credential })) as {
    present?: unknown;
  };
  return json.present === true;
}

export async function authClear(credential: Credential): Promise<void> {
  await postJson("/api/auth/clear", { credential });
}

export async function authList(): Promise<Credential[]> {
  let res: Response;
  try {
    res = await fetch(await apiUrl("/api/auth/list"));
  } catch (err) {
    throw new AuthClientError(
      "unknown",
      err instanceof Error ? err.message : "Network error",
    );
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const discriminator =
      typeof json.error === "string" ? json.error : "unknown";
    throw new AuthClientError(discriminator);
  }
  if (!Array.isArray(json.credentials)) {
    throw new AuthClientError("unknown", "missing credentials array");
  }
  return json.credentials as Credential[];
}
