// Shared GitHub PR + token-modal flow used by Welcome, LoadModal, and the
// ReviewWorkspace refresh path. Folds the keychain rehydrate, token-required
// re-prompt, and auth-rejected re-prompt branches into one place so adding a
// new ingest surface doesn't spawn a fourth copy.
//
// The hook is presentation-agnostic: it returns state + handlers; callers
// render their own modal chrome. The default modal component is exported
// alongside.

import { useState } from "react";
import {
  loadGithubPr,
  GithubFetchError,
  GH_ERROR_MESSAGES,
  type PrLoadResult,
} from "./githubPrClient";
import { isTauri, keychainGet } from "./keychain";
import { useCredentials } from "./auth/useCredentials";
import { keychainAccountFor } from "./auth/credential";

export interface UseGithubPrLoadOptions {
  /**
   * Called on a successful load. The caller dispatches LOAD_CHANGESET +
   * MERGE_PR_REPLIES (or whatever fits its surface) using the result.
   */
  onResult: (result: PrLoadResult, prUrl: string) => void;
}

export interface TokenModalState {
  host: string;
  reason: "first-time" | "rejected";
  pendingPrUrl: string;
}

export function useGithubPrLoad({ onResult }: UseGithubPrLoadOptions) {
  const credentials = useCredentials();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenModal, setTokenModal] = useState<TokenModalState | null>(null);

  /**
   * Fire a PR load. On `github_token_required`, try the Tauri Keychain
   * cache first; fall back to opening the token modal. On
   * `github_auth_failed`, open the modal in the "rejected" state. Other
   * discriminators surface as an inline error.
   */
  async function loadPr(prUrl: string): Promise<void> {
    if (!prUrl.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const result = await loadGithubPr(prUrl);
      onResult(result, prUrl);
    } catch (err) {
      if (err instanceof GithubFetchError) {
        if (err.discriminator === "github_token_required" && err.host) {
          if (isTauri()) {
            const cached = await keychainGet(
              keychainAccountFor({ kind: "github", host: err.host }),
            );
            if (cached) {
              await credentials.set({ kind: "github", host: err.host }, cached);
              setBusy(false);
              return loadPr(prUrl); // retry once with the cached token
            }
          }
          setTokenModal({
            host: err.host,
            reason: "first-time",
            pendingPrUrl: prUrl,
          });
        } else if (err.discriminator === "github_auth_failed") {
          setTokenModal({
            host: err.host ?? "github.com",
            reason: "rejected",
            pendingPrUrl: prUrl,
          });
        } else {
          setError(GH_ERROR_MESSAGES[err.discriminator] ?? err.discriminator);
        }
      } else {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    } finally {
      setBusy(false);
    }
  }

  /** Caller hands this to GitHubTokenModal's onSubmit. Pushes the token to
   *  Keychain (Tauri) and the server through `useCredentials().set`, then
   *  retries the pending PR load. Throws on auth-failed so the modal's own
   *  catch surfaces the rejection inline — closing the modal and reopening
   *  it via `loadPr` (the previous behaviour) hid the cause behind a flicker. */
  async function submitToken(host: string, token: string): Promise<void> {
    await credentials.set({ kind: "github", host }, token);
    const pendingUrl = tokenModal?.pendingPrUrl;
    if (!pendingUrl) {
      setTokenModal(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await loadGithubPr(pendingUrl);
      onResult(result, pendingUrl);
      setTokenModal(null);
    } catch (err) {
      if (
        err instanceof GithubFetchError &&
        err.discriminator === "github_auth_failed"
      ) {
        // Re-throw — the modal's handleSubmit catches and renders this
        // inline, keeping the password input in place for another try.
        throw new Error(
          `Token rejected by ${err.host ?? host}. Check the PAT scopes (repo + read:org for private repos) and try again.`,
          { cause: err },
        );
      }
      if (err instanceof GithubFetchError) {
        setTokenModal(null);
        setError(GH_ERROR_MESSAGES[err.discriminator] ?? err.discriminator);
        return;
      }
      setTokenModal(null);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  function dismissTokenModal(): void {
    setTokenModal(null);
  }

  return {
    busy,
    error,
    tokenModal,
    loadPr,
    submitToken,
    dismissTokenModal,
    /** Set an inline error from outside (e.g., URL validation). */
    setError,
  };
}

/**
 * Returns true if the URL points at a GitHub PR HTML page (e.g.,
 * `https://github.com/owner/repo/pull/123`). Used by the unified URL field
 * to route to `loadGithubPr` instead of plain `fetch`. Match-only: invalid
 * URLs fall through to the diff-URL path which already handles the error.
 */
export function isGithubPrUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return /\/[^/]+\/[^/]+\/pulls?\/\d+\/?$/.test(u.pathname);
  } catch {
    return false;
  }
}
