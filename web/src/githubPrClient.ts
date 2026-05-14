// Thin client over the GitHub PR endpoints. See server/src/index.ts for the
// handler implementations and server/src/github/ for the domain logic.
//
// Error convention: non-2xx responses are thrown as GithubFetchError so
// callers can branch on `discriminator` without parsing raw status codes.

import { apiUrl } from "./apiUrl";
import type { ChangeSet, DetachedInteraction, Interaction } from "./types";

export interface PrLoadResult {
  changeSet: ChangeSet;
  /** PR review comments anchored in the current diff, bucketed by thread key. */
  prInteractions: Record<string, Interaction[]>;
  /** PR review comments that no longer anchor (outdated, or off the patch view). */
  prDetached: DetachedInteraction[];
}

/** Friendly user-facing messages for non-auth GitHub error discriminators. */
export const GH_ERROR_MESSAGES: Record<string, string> = {
  github_pr_not_found: "PR not found.",
  github_upstream: "GitHub returned an error. Try again.",
  github_network: "Couldn't reach GitHub. Check your network or proxy.",
  invalid_pr_url: "That doesn't look like a valid PR URL.",
  unknown: "Something went wrong loading the PR.",
};

export interface PrMatch {
  host: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  htmlUrl: string;
}

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

export async function loadGithubPr(prUrl: string): Promise<PrLoadResult> {
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
    const detail =
      typeof json.detail === "string" ? json.detail : undefined;

    const knownDiscriminators = [
      "github_token_required",
      "github_auth_failed",
      "github_pr_not_found",
      "github_upstream",
      "github_network",
      "invalid_pr_url",
    ];

    // For github_network, pass the transport-layer detail as the Error
    // message so the inline display can surface "ECONNREFUSED" / "Connect
    // Timeout" instead of just the friendly fallback.
    throw new GithubFetchError(
      knownDiscriminators.includes(discriminator) ? discriminator : "unknown",
      detail ?? discriminator,
      host,
      hint,
    );
  }

  if (!json.changeSet || typeof json.changeSet !== "object") {
    throw new GithubFetchError("unknown", "Unexpected response from server");
  }

  return {
    changeSet: json.changeSet as ChangeSet,
    prInteractions: (json.prInteractions ?? {}) as Record<string, Interaction[]>,
    prDetached: (json.prDetached ?? []) as DetachedInteraction[],
  };
}

export async function lookupPrForBranch(
  worktreePath: string,
): Promise<{ matched: PrMatch | null }> {
  let res: Response;
  try {
    res = await fetch(await apiUrl("/api/github/pr/branch-lookup"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worktreePath }),
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
    throw new GithubFetchError(discriminator, discriminator, host);
  }

  return { matched: (json.matched ?? null) as PrMatch | null };
}
