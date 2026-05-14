// Unified Credentials surface. Rendered in two modes:
// - `boot`: anthropic-only, with Skip alongside Save. Shown by ServerHealthGate
//   on missing-and-not-skipped state.
// - `settings`: full list of configured credentials, plus an Add GitHub host
//   action. No skip — settings is the proactive escape hatch.
//
// All persistence funnels through `useCredentials`, which handles the Keychain
// write (Tauri) + /api/auth/set call.

import { useState } from "react";
import "./CredentialsPanel.css";
import { useCredentials } from "../auth/useCredentials";
import type { Credential } from "../auth/credential";
import { AuthClientError } from "../auth/client";
import {
  githubApiBaseForHost,
  isGithubDotCom,
  readTrustedGithubHosts,
  trustGithubHost,
} from "../githubHostTrust";

interface Props {
  mode: "boot" | "settings";
}

type Editing =
  | { kind: "anthropic" }
  | { kind: "github"; host: string };

export function CredentialsPanel({ mode }: Props) {
  const credentials = useCredentials();
  const [editing, setEditing] = useState<Editing | null>(
    mode === "boot" ? { kind: "anthropic" } : null,
  );
  const [addOpen, setAddOpen] = useState(false);
  // Panel-level error slot for actions whose feedback can't live in the
  // row (clear in particular — the row unmounts as soon as `refresh()`
  // updates the list, so an inline error inside the row is dropped
  // along with it). Auto-cleared on the next action.
  const [actionErr, setActionErr] = useState<string | null>(null);

  const hasAnthropic = credentials.list.some((c) => c.kind === "anthropic");
  const githubHosts = credentials.list.flatMap((c) =>
    c.kind === "github" ? [c.host] : [],
  );

  async function clearCredential(credential: Credential): Promise<void> {
    setActionErr(null);
    try {
      await credentials.clear(credential);
    } catch (e) {
      // The server-side clear already succeeded (the row will be gone
      // when this resolves); only the Keychain step failed. Tell the
      // user about it so they know the entry may resurrect on relaunch.
      setActionErr(
        `Cleared on the server, but the Keychain delete didn't go through: ${
          e instanceof Error ? e.message : String(e)
        }. The entry may come back on next launch.`,
      );
    }
  }

  return (
    <div className="creds">
      <div className="creds__title">
        {mode === "boot" ? "set up your anthropic api key" : "credentials"}
      </div>
      {mode === "boot" && (
        <p className="creds__lead">
          Shippable calls Claude to generate review plans. Paste your key —
          it’s stored in macOS Keychain (service: <code>shippable</code>) and
          never leaves this machine. You can also skip and use the rule-based
          plan; AI is opt-in.
        </p>
      )}

      {actionErr && (
        <div className="creds__alert" role="alert">
          <span>{actionErr}</span>
          <button
            type="button"
            className="creds__alert-close"
            aria-label="dismiss"
            onClick={() => setActionErr(null)}
          >
            ×
          </button>
        </div>
      )}

      <CredentialRow
        label="anthropic"
        present={hasAnthropic}
        placeholder="sk-ant-..."
        editing={
          editing && editing.kind === "anthropic" ? editing : null
        }
        onStartEdit={() => setEditing({ kind: "anthropic" })}
        onCancelEdit={
          mode === "boot" ? undefined : () => setEditing(null)
        }
        onSubmit={async (value) => {
          await credentials.set({ kind: "anthropic" }, value);
          if (mode === "settings") setEditing(null);
        }}
        onClear={
          mode === "settings" && hasAnthropic
            ? () => clearCredential({ kind: "anthropic" })
            : undefined
        }
      />

      {mode === "settings" &&
        githubHosts.map((host) => (
          <CredentialRow
            key={host}
            label={host}
            present={true}
            placeholder="ghp_…"
            editing={
              editing && editing.kind === "github" && editing.host === host
                ? editing
                : null
            }
            onStartEdit={() => setEditing({ kind: "github", host })}
            onCancelEdit={() => setEditing(null)}
            onSubmit={async (value) => {
              await credentials.set({ kind: "github", host }, value);
              setEditing(null);
            }}
            onClear={() => clearCredential({ kind: "github", host })}
          />
        ))}

      {mode === "boot" && (
        <div className="creds__skip">
          <button
            type="button"
            className="creds__skip-btn"
            onClick={() => credentials.skipAnthropic()}
          >
            Skip — use rule-based only
          </button>
          <span className="creds__skip-hint">
            You can re-enable later from Settings.
          </span>
        </div>
      )}

      {mode === "settings" && (
        <AddGithubHost
          open={addOpen}
          onOpen={() => setAddOpen(true)}
          onClose={() => setAddOpen(false)}
          existingHosts={githubHosts}
          onSubmit={async (host, token) => {
            await credentials.set({ kind: "github", host }, token);
            setAddOpen(false);
          }}
        />
      )}

      <p className="creds__meta">
        {mode === "boot" ? (
          <>
            Need a key?{" "}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noreferrer"
            >
              Create one in the Anthropic Console
            </a>
            .
          </>
        ) : (
          <>Credentials live in macOS Keychain (Tauri) or server memory (dev).</>
        )}
      </p>
    </div>
  );
}

interface RowProps {
  label: string;
  present: boolean;
  placeholder: string;
  editing: Editing | null;
  onStartEdit: () => void;
  onCancelEdit?: () => void;
  onSubmit: (value: string) => Promise<void>;
  onClear?: () => Promise<void> | void;
}

function CredentialRow({
  label,
  present,
  placeholder,
  editing,
  onStartEdit,
  onCancelEdit,
  onSubmit,
  onClear,
}: RowProps) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(trimmed);
      setValue("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    if (!onClear) return;
    setBusy(true);
    try {
      // Errors are caught and surfaced at the panel level — by the
      // time this resolves the row is typically gone (the list
      // refresh runs as part of clear), so inline state would be lost.
      await onClear();
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="creds__row">
        <span className="creds__row-label">{label}</span>
        <div className="creds__edit">
          <input
            className="creds__input"
            type="password"
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy && value.trim()) submit();
            }}
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
          <button
            className="creds__btn creds__btn--primary"
            disabled={busy || !value.trim()}
            onClick={submit}
          >
            {busy ? "Saving…" : "Save"}
          </button>
          {onCancelEdit && (
            <button
              className="creds__btn"
              onClick={onCancelEdit}
              disabled={busy}
            >
              cancel
            </button>
          )}
        </div>
        {err && <p className="creds__error" role="alert">{err}</p>}
      </div>
    );
  }

  return (
    <div className="creds__row">
      <span className="creds__row-label" title={label}>
        {label}
      </span>
      <span className="creds__row-state">{present ? "set" : "not set"}</span>
      <button
        className="creds__btn"
        onClick={onStartEdit}
        aria-label={`${present ? "rotate" : "set"} ${label}`}
        disabled={busy}
      >
        {present ? "rotate" : "set"}
      </button>
      {onClear && (
        <button
          className="creds__btn creds__btn--danger"
          onClick={handleClear}
          aria-label={`clear ${label}`}
          disabled={busy}
        >
          {busy ? "clearing…" : "clear"}
        </button>
      )}
      {err && <p className="creds__error" role="alert">{err}</p>}
    </div>
  );
}

interface AddProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  existingHosts: string[];
  onSubmit: (host: string, token: string) => Promise<void>;
}

function AddGithubHost({ open, onOpen, onClose, existingHosts, onSubmit }: AddProps) {
  const [host, setHost] = useState("");
  const [token, setToken] = useState("");
  const [trustedHosts, setTrustedHosts] = useState<string[]>(() =>
    readTrustedGithubHosts(),
  );
  const [stage, setStage] = useState<"host" | "trust" | "token">("host");
  const [busy, setBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  // Reset the form whenever the user closes the add flow (cancel button,
  // backdrop click via parent, successful submit, etc.). Without this the
  // next time the user clicks "+ Add GitHub host" the component is still
  // mounted from the previous open and resumes wherever they left off —
  // typically the trust interstitial or the token-paste step, which is
  // jarring and lets a typed host bleed into a new add. The set-in-render
  // pattern (guarded with `host !== ""` etc.) is safer here than a
  // useEffect because there's no external system to sync — we're deriving
  // local state from a prop.
  if (!open && (host !== "" || token !== "" || stage !== "host" || submitErr || busy)) {
    setHost("");
    setToken("");
    setStage("host");
    setSubmitErr(null);
    setBusy(false);
  }

  if (!open) {
    return (
      <div className="creds__add">
        <button className="creds__btn" onClick={onOpen}>
          + Add GitHub host
        </button>
      </div>
    );
  }

  const normalised = host.trim().toLowerCase();
  const isDuplicate =
    normalised !== "" && existingHosts.includes(normalised);
  const hostTrusted =
    isGithubDotCom(normalised) || trustedHosts.includes(normalised);

  function nextFromHost() {
    if (!normalised || isDuplicate) return;
    setStage(hostTrusted ? "token" : "trust");
  }

  function confirmTrust() {
    trustGithubHost(normalised);
    setTrustedHosts(readTrustedGithubHosts());
    setStage("token");
  }

  async function submit() {
    if (!normalised || !token.trim()) return;
    setBusy(true);
    setSubmitErr(null);
    try {
      await onSubmit(normalised, token.trim());
      setHost("");
      setToken("");
      setStage("host");
    } catch (e) {
      // host_blocked is the common case (private/loopback IPs, GHE on a
      // local network) — give the user a concrete reason. Anything else
      // surfaces with the raw message.
      if (e instanceof AuthClientError && e.discriminator === "host_blocked") {
        setSubmitErr(
          `${normalised} is on the local-network blocklist — Shippable refuses to send tokens to private, loopback, or link-local hosts.`,
        );
      } else {
        setSubmitErr(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  if (stage === "trust") {
    return (
      <div className="creds__add">
        <p className="creds__meta">
          Confirm that <code>{normalised}</code> is your organisation’s GitHub
          Enterprise host. Shippable will send the token only to{" "}
          <code>{githubApiBaseForHost(normalised)}</code>.
        </p>
        <div className="creds__actions">
          <button
            className="creds__btn creds__btn--primary"
            onClick={confirmTrust}
          >
            I trust {normalised}
          </button>
          <button className="creds__btn" onClick={onClose}>
            cancel
          </button>
        </div>
      </div>
    );
  }

  if (stage === "token") {
    return (
      <div className="creds__add">
        <p className="creds__meta">
          Paste a Personal Access Token for <code>{normalised}</code>.
        </p>
        <div className="creds__add-row">
          <input
            className="creds__input"
            type="password"
            placeholder="ghp_…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
          <button
            className="creds__btn creds__btn--primary"
            disabled={busy || !token.trim()}
            onClick={submit}
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button className="creds__btn" onClick={onClose} disabled={busy}>
            cancel
          </button>
        </div>
        {submitErr && <p className="creds__error" role="alert">{submitErr}</p>}
      </div>
    );
  }

  return (
    <div className="creds__add">
      <div className="creds__add-row">
        <input
          className="creds__input"
          type="text"
          placeholder="host (e.g. ghe.example.com)"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && nextFromHost()}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          list="creds-trusted-hosts"
        />
        <datalist id="creds-trusted-hosts">
          {trustedHosts.map((h) => (
            <option key={h} value={h} />
          ))}
        </datalist>
        <button
          className="creds__btn creds__btn--primary"
          disabled={!normalised || isDuplicate}
          onClick={nextFromHost}
        >
          continue
        </button>
        <button className="creds__btn" onClick={onClose}>
          cancel
        </button>
      </div>
      {isDuplicate && (
        <p className="creds__error" role="alert">
          A credential for <code>{normalised}</code> already exists; use Rotate
          on the existing row.
        </p>
      )}
    </div>
  );
}

