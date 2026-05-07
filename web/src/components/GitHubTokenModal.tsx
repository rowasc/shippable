import { useState } from "react";
import { createPortal } from "react-dom";
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

  const helpUrl =
    host === "github.com"
      ? "https://github.com/settings/tokens"
      : `https://${host}/settings/tokens`;

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
          <p className="modal__hint">
            {reason === "first-time"
              ? `Shippable needs a GitHub Personal Access Token to load ${host} PRs. Tokens are stored in macOS Keychain (or in server memory in dev mode).`
              : `The token for ${host} was rejected. Re-enter it to retry.`}
          </p>
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
        </section>
      </div>
    </div>
  );

  // Render into document.body so this modal is a sibling of any parent modal
  // in the DOM — prevents double backdrops when GitHubTokenModal opens from
  // inside LoadModal.
  return createPortal(content, document.body);
}
