import { useEffect, useState, type ReactNode } from "react";
import "./ServerHealthGate.css";
import { apiUrl } from "../apiUrl";
import { useApiKey } from "../useApiKey";
import { CopyButton } from "./CopyButton";
import { KeySetup } from "./KeySetup";

type GateState = "checking" | "ready" | "unreachable";

/**
 * Boot-time gate. The local Node sidecar is a hard dependency in every
 * deployment shape we ship — worktree ingest, prompt library, streaming
 * review all live there. Without it the app can’t function, so failing here
 * is more honest than letting the user load a diff and discover features
 * error out one by one.
 *
 * In Tauri context, we surface the keychain prompt before the health probe.
 * The user can save a key (next launch enables AI plans) or skip and fall
 * through to the rule-based plan; either way, the bundled sidecar still
 * runs and `/api/health` succeeds.
 */
export function ServerHealthGate({ children }: { children: ReactNode }) {
  const apiKey = useApiKey();
  const [state, setState] = useState<GateState>("checking");
  const [error, setError] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const [trackedAttempt, setTrackedAttempt] = useState(attempt);

  // Don't run the health probe until we've resolved the keychain state in
  // Tauri — otherwise we race with sidecar startup and surface a generic
  // "unreachable" instead of the specific "missing key" path. "skipped" is
  // a deliberate dismissal, so the gate proceeds and the rule-based plan
  // takes over for AI features.
  const blockedByMissingKey =
    apiKey.status.kind === "missing" ||
    apiKey.status.kind === "saved-pending-restart";
  const waitingForKeycheck = apiKey.status.kind === "loading";

  // Reset state when the user clicks Retry. The during-render setState
  // pattern keeps these resets out of the effect body (which would cascade).
  if (attempt !== trackedAttempt) {
    setTrackedAttempt(attempt);
    setState("checking");
    setError(undefined);
  }

  useEffect(() => {
    if (blockedByMissingKey || waitingForKeycheck) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(await apiUrl("/api/health"));
        if (cancelled) return;
        if (res.ok) {
          setState("ready");
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
  }, [attempt, blockedByMissingKey, waitingForKeycheck]);

  if (blockedByMissingKey) {
    return (
      <div className="boot-gate">
        <div
          className="boot-gate__box"
          role="dialog"
          aria-modal="true"
          aria-label="set up Anthropic API key"
        >
          <KeySetup
            onSave={apiKey.save}
            onSkip={apiKey.skip}
            saved={apiKey.status.kind === "saved-pending-restart"}
          />
        </div>
      </div>
    );
  }

  if (state === "ready") return <>{children}</>;

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
