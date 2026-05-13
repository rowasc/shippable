import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  githubApiBaseForHost,
  isGithubDotCom,
  readTrustedGithubHosts,
  trustGithubHost,
} from "../githubHostTrust";
import "./LoadModal.css";

interface Props {
  host: string;
  reason: "first-time" | "rejected";
  onSubmit: (host: string, token: string) => Promise<void>;
  onCancel: () => void;
}

export function GitHubTokenModal({ host, reason, onSubmit, onCancel }: Props) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [trustedHosts, setTrustedHosts] = useState(readTrustedGithubHosts);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const needsHostTrust = !isGithubDotCom(host);
  const hostTrusted =
    isGithubDotCom(host) || trustedHosts.includes(host.trim().toLowerCase());
  const helpUrl =
    !needsHostTrust
      ? "https://github.com/settings/tokens"
      : `https://${host}/settings/tokens`;
  const showHostTrust = needsHostTrust && !hostTrusted;
  const apiBase = githubApiBaseForHost(host);

  async function handleSubmit() {
    if (!token.trim()) return;
    setErr(null);
    setBusy(true);
    try {
      await onSubmit(host, token.trim());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save token");
      setBusy(false);
    }
    // On success the parent unmounts this modal — no need to setBusy(false).
  }

  function handleTrustHost() {
    trustGithubHost(host);
    setTrustedHosts(readTrustedGithubHosts());
  }

  const content = (
    <div className="modal" onClick={onCancel}>
      <div className="modal__box" onClick={(e) => e.stopPropagation()}>
        <header className="modal__h">
          <span className="modal__h-label">GitHub token required</span>
          <button className="modal__close" onClick={onCancel}>
            × close
          </button>
        </header>

        <section className="modal__sec">
          {showHostTrust ? (
            <>
              <p className="modal__hint">
                Before you paste a token, confirm that {host} is your
                organization&apos;s GitHub Enterprise domain.
              </p>
              <p className="modal__hint">
                Shippable will send this token only to <code>{apiBase}</code>.
                Continue only if you recognize this domain.
              </p>
              <div className="modal__row">
                <button
                  className="modal__btn modal__btn--primary"
                  onClick={handleTrustHost}
                  autoFocus
                >
                  I trust {host}
                </button>
                <button className="modal__btn" onClick={onCancel}>
                  cancel
                </button>
              </div>
            </>
          ) : (
            <>
              {reason === "rejected" ? (
                // Render the rejection prominently so the user can't miss it
                // — this same modal is the destination for *both* the
                // first-time prompt and a wrong-PAT retry, and a subtle
                // .modal__hint got mistaken for fresh-prompt copy.
                <p className="modal__hint modal__hint--error">
                  GitHub rejected the saved token for {host}. Re-enter the
                  PAT (or generate a new one with `repo` + `read:org` scopes
                  for private repos).
                </p>
              ) : (
                <p className="modal__hint">
                  Shippable needs a GitHub Personal Access Token to load
                  {" "}{host} PRs. Tokens are stored in macOS Keychain (or in
                  server memory in dev mode).
                </p>
              )}
              {needsHostTrust && (
                <p className="modal__hint">
                  Token destination: <code>{apiBase}</code>
                </p>
              )}
              <p className="modal__hint">
                <a href={helpUrl} target="_blank" rel="noreferrer">
                  Help: how to create a PAT
                </a>
              </p>
              <div className="modal__row">
                <input
                  className="modal__input"
                  type="password"
                  placeholder="ghp_…"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  aria-label="Personal Access Token"
                  autoFocus
                />
                <button
                  className="modal__btn modal__btn--primary"
                  onClick={handleSubmit}
                  disabled={busy || !token.trim()}
                >
                  {busy ? "saving…" : `Save token for ${host}`}
                </button>
              </div>
              {err && <p className="modal__hint modal__hint--error">{err}</p>}
            </>
          )}
        </section>
      </div>
    </div>
  );

  // Render into document.body so this modal is a sibling of any parent modal
  // in the DOM — prevents double backdrops when GitHubTokenModal opens from
  // inside LoadModal.
  return createPortal(content, document.body);
}
