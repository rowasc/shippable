import { useEffect, useState } from "react";

const ACCOUNT = "ANTHROPIC_API_KEY";

export type ApiKeyStatus =
  | { kind: "loading" }
  // No Tauri context (browser dev mode). Assume the standalone server has
  // the key via shell env; we have no way to introspect it from the browser
  // and shouldn't gate the UI on it.
  | { kind: "browser" }
  | { kind: "present" }
  | { kind: "missing" }
  | { kind: "saved-pending-restart" }
  // The user dismissed the first-run prompt. The bundled server still
  // works (worktrees, prompt library, rule-based plan); only AI plan +
  // streaming review return 503 until a key is added.
  | { kind: "skipped" }
  | { kind: "error"; message: string };

function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
  );
}

/**
 * Tracks whether the bundled app has an Anthropic API key in macOS Keychain
 * and exposes save/skip actions for the first-run setup screen.
 */
export function useApiKey() {
  // Resolve the browser-vs-Tauri branch synchronously so the effect doesn't
  // need to call setStatus on its first pass; only the async keychain probe
  // updates state.
  const [status, setStatus] = useState<ApiKeyStatus>(() =>
    isTauri() ? { kind: "loading" } : { kind: "browser" },
  );

  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const value = await invoke<string | null>("keychain_get", {
          account: ACCOUNT,
        });
        setStatus(value !== null ? { kind: "present" } : { kind: "missing" });
      } catch (err) {
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }, []);

  const save = async (key: string): Promise<void> => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke<void>("keychain_set", { account: ACCOUNT, password: key });
    // The sidecar is spawned at app startup, so a saved key only takes effect
    // on the next launch. Surface that explicitly instead of silently leaving
    // the user in a state where AI plans appear "saved" but still don't work.
    setStatus({ kind: "saved-pending-restart" });
  };

  const skip = () => setStatus({ kind: "skipped" });

  return { status, save, skip };
}
