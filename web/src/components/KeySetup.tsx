import { useState } from "react";
import "./KeySetup.css";
import { CopyButton } from "./CopyButton";

interface Props {
  /** Persists the key to Keychain. Throws on failure. */
  onSave: (key: string) => Promise<void>;
  /** Dismisses the form without saving. The bundled server still runs and
   *  the rule-based plan keeps working; only the AI-generated plan + the
   *  prompt-streaming endpoints are disabled until a key is added. */
  onSkip?: () => void;
  /** True after a successful save; switches the card to the restart message. */
  saved: boolean;
}

export function KeySetup({ onSave, onSkip, saved }: Props) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div className="key-setup">
        <div className="key-setup__box">
          <div className="key-setup__title">key saved</div>
          <p className="key-setup__saved-body">
            Quit and relaunch Shippable to enable AI-generated plans. The
            sidecar process picks up the key at startup.
          </p>
          <p className="key-setup__meta">
            Stored in macOS Keychain (service: <code>shippable</code>).
            Remove anytime with{" "}
            <code>security delete-generic-password -s shippable -a ANTHROPIC_API_KEY</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="key-setup">
      <div
        className="key-setup__box"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !saving && value.trim()) submit();
        }}
      >
        <div className="key-setup__title">set up your anthropic api key</div>
        <p className="key-setup__lead">
          Shippable calls Claude to generate review plans. Paste your key —
          it’s stored in macOS Keychain (service: <code>shippable</code>) and
          never leaves this machine. You can also skip and use the rule-based
          plan; AI is opt-in.
        </p>
        <div className="key-setup__field">
          <label className="key-setup__label" htmlFor="key-setup-input">
            api key
          </label>
          <input
            id="key-setup-input"
            className="key-setup__input"
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="sk-ant-..."
            autoFocus
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        {error && (
          <p className="key-setup__error errrow">
            <span className="errrow__msg">{error}</span>
            <CopyButton text={error} />
          </p>
        )}
        <div className="key-setup__actions">
          <button
            className="key-setup__save"
            disabled={!value.trim() || saving}
            onClick={submit}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {onSkip && (
            <button
              className="key-setup__skip"
              onClick={onSkip}
              disabled={saving}
            >
              Skip — use rule-based only
            </button>
          )}
        </div>
        <p className="key-setup__meta">
          Need a key?{" "}
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noreferrer"
          >
            Create one in the Anthropic Console
          </a>
          .
        </p>
      </div>
    </div>
  );
}
