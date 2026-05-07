// Thin client over the GitHub PR endpoints. See server/src/index.ts for the
// handler implementations and server/src/github/ for the domain logic.
//
// Error convention: non-2xx responses are thrown as GithubFetchError so
// callers can branch on `discriminator` without parsing raw status codes.

import { apiUrl } from "./apiUrl";
import type { ChangeSet } from "./types";

export class GithubFetchError extends Error {
  discriminator: string;
  host?: string;
  hint?: string;

  constructor(
    discriminator: string,
    message: string,
    host?: string,
    hint?: string,
  ) {
    super(message);
    this.name = "GithubFetchError";
    this.discriminator = discriminator;
    this.host = host;
    this.hint = hint;
  }
}

export async function setGithubToken(
  host: string,
  token: string,
): Promise<void> {
  const res = await fetch(await apiUrl("/api/github/auth/set"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ host, token }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }
}


export async function loadGithubPr(prUrl: string): Promise<ChangeSet> {
  // Basic local validation before hitting the server.
  if (!prUrl.trim()) {
    throw new GithubFetchError("invalid_pr_url", "PR URL is required");
  }

  let res: Response;
  try {
    res = await fetch(await apiUrl("/api/github/pr/load"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prUrl }),
    });
  } catch (err) {
    throw new GithubFetchError(
      "unknown",
      err instanceof Error ? err.message : "Network error",
    );
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const discriminator =
      typeof json.error === "string" ? json.error : "unknown";
    const host = typeof json.host === "string" ? json.host : undefined;
    const hint = typeof json.hint === "string" ? json.hint : undefined;

    const knownDiscriminators = [
      "github_token_required",
      "github_auth_failed",
      "github_pr_not_found",
      "github_upstream",
      "invalid_pr_url",
    ];

    throw new GithubFetchError(
      knownDiscriminators.includes(discriminator) ? discriminator : "unknown",
      discriminator,
      host,
      hint,
    );
  }

  if (!json.changeSet || typeof json.changeSet !== "object") {
    throw new GithubFetchError("unknown", "Unexpected response from server");
  }

  return json.changeSet as ChangeSet;
}
