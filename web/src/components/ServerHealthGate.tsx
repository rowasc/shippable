import { useEffect, useState, type ReactNode } from "react";
import "./ServerHealthGate.css";
import { apiUrl, waitForSidecarReady } from "../apiUrl";
import { CopyButton } from "./CopyButton";
import { CredentialsPanel } from "./CredentialsPanel";
import { useCredentials } from "../auth/useCredentials";

type GateState = "checking" | "ready" | "unreachable" | "db-error";

/**
 * Boot-time gate. The local Node sidecar is a hard dependency in every
 * deployment shape we ship — worktree ingest, prompt library, streaming
 * review all live there. Without it the app can't function, so failing here
 * is more honest than letting the user load a diff and discover features
 * error out one by one.
 *
 * The Anthropic key, by contrast, is optional: the server boots without it.
 * Credential presence comes from `useCredentials().list`. When the anthropic
 * row is missing AND the user hasn't dismissed the prompt, we render the
 * boot CredentialsPanel; otherwise the gate falls through to `children` and
 * the rule-based plan takes over.
 */
export function ServerHealthGate({ children }: { children: ReactNode }) {
  const credentials = useCredentials();
  const [state, setState] = useState<GateState>("checking");
  const [error, setError] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const [trackedAttempt, setTrackedAttempt] = useState(attempt);
  // Once the gate has fallen through to `children` once, never re-show the
  // boot panel: in-session credential changes (clearing or rotating from
  // Settings) would otherwise unmount the workspace and lose its state.
  // Settings is the right place to manage credentials post-onboarding; the
  // gate is a first-launch concern only.
  const [bootResolved, setBootResolved] = useState(false);

  if (attempt !== trackedAttempt) {
    setTrackedAttempt(attempt);
    setState("checking");
    setError(undefined);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // In Tauri, block on a `shippable:sidecar-ready` event from Rust
        // before probing — the WebView mounts before the Node listener
        // binds, and the old single-shot probe lost that race.
        const ready = await waitForSidecarReady();
        if (cancelled) return;
        if (!ready.ok) {
          setState("unreachable");
          setError(ready.reason);
          return;
        }
        const res = await fetch(await apiUrl("/api/health"));
        if (cancelled) return;
        if (res.ok) {
          const body = await res.json().catch(() => ({}));
          // db field absent means an older server — don't block (pragmatic for a prototype).
          if (body?.db?.status === "error") {
            setState("db-error");
            setError(body.db.error ?? "database unavailable");
          } else {
            setState("ready");
          }
        } else {
          setState("unreachable");
          setError(`HTTP ${res.status} ${res.statusText}`);
        }
      } catch (err) {
        if (cancelled) return;
        setState("unreachable");
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Wait for credentials to resolve (initial rehydrate finishes by calling
  // refresh, which flips status to "ready" or "error") before deciding which
  // branch to render. Without this gate the boot panel can flash for a frame
  // on Tauri cold start while Keychain reads are still in flight.
  const hasAnthropic = credentials.list.some((c) => c.kind === "anthropic");
  const gateReady = state === "ready" && credentials.status !== "loading";
  const passingThrough =
    gateReady && (bootResolved || hasAnthropic || credentials.anthropicSkipped);
  // Latch the resolved flag the first time we'd fall through to children, so
  // subsequent in-session credential changes don't re-trigger the boot panel.
  // Guarded with !bootResolved to avoid infinite re-render loops.
  if (passingThrough && !bootResolved) {
    setBootResolved(true);
  }

  if (state === "db-error") {
    return (
      <div className="boot-gate">
        <div
          className="boot-gate__box"
          role="dialog"
          aria-modal="true"
          aria-label="server status"
        >
          <div className="boot-gate__label">shippable</div>
          <h1 className="boot-gate__h">Database unavailable</h1>
          <p className="boot-gate__msg">
            The server started but its database couldn't be opened. Review
            storage and persistence depend on it.
          </p>
          {error && (
            <div className="boot-gate__err errrow">
              <span className="errrow__msg">{error}</span>
              <CopyButton text={error} />
            </div>
          )}
          <p className="boot-gate__hint">
            Fix the underlying problem (e.g. set <code>HOME</code> or check
            disk permissions), then restart the server.
          </p>
          <div className="boot-gate__actions">
            <button
              type="button"
              className="boot-gate__btn"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (gateReady) {
    if (passingThrough) return <>{children}</>;
    return (
      <div className="boot-gate">
        <div
          className="boot-gate__box"
          role="dialog"
          aria-modal="true"
          aria-label="set up Anthropic API key"
        >
          <CredentialsPanel mode="boot" />
        </div>
      </div>
    );
  }

  return (
    <div className="boot-gate">
      <div
        className="boot-gate__box"
        role="dialog"
        aria-modal="true"
        aria-label="server status"
      >
        <div className="boot-gate__label">shippable</div>
        {state === "checking" ? (
          <p className="boot-gate__msg">Checking server…</p>
        ) : (
          <>
            <h1 className="boot-gate__h">Server unreachable</h1>
            <p className="boot-gate__msg">
              The shippable backend isn’t responding. It runs the worktree
              loader, the prompt library, and the streaming review — without
              it the app can’t function. (AI plan generation also lives there
              but is opt-in; the rule-based plan works regardless.)
            </p>
            {error && (
              <div className="boot-gate__err errrow">
                <span className="errrow__msg">{error}</span>
                <CopyButton text={error} />
              </div>
            )}
            <p className="boot-gate__hint">
              In dev: <code>cd server &amp;&amp; npm run dev</code>. Desktop:
              the bundled sidecar starts at app launch — quit and relaunch
              after fixing the underlying problem.
            </p>
            <div className="boot-gate__actions">
              <button
                type="button"
                className="boot-gate__btn"
                onClick={() => setAttempt((n) => n + 1)}
              >
                Retry
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
