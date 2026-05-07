import "./PromptEditor.css";
import { useMemo, useState } from "react";
import {
  type AutoFillContext,
  type Prompt,
  type PromptArg,
  type PromptDraft,
  deleteUserPrompt,
  renderTemplate,
  resolveAuto,
  saveUserPrompt,
  slugifyId,
} from "../promptStore";
import { CopyButton } from "./CopyButton";

const AUTO_OPTIONS = [
  { value: "", label: "(none)" },
  { value: "selection", label: "selection" },
  { value: "file", label: "file path" },
  { value: "changeset.title", label: "changeset title" },
  { value: "changeset.diff", label: "changeset diff" },
];

interface Props {
  // null → creating from scratch. Otherwise, editing or forking.
  initial: Prompt | null;
  context: AutoFillContext;
  onSaved: (saved: Prompt) => void;
  onCancel: () => void;
  onDeleted?: (id: string) => void;
}

export function PromptEditor({
  initial,
  context,
  onSaved,
  onCancel,
  onDeleted,
}: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [args, setArgs] = useState<PromptArg[]>(
    initial?.args.map((a) => ({ ...a })) ?? [],
  );
  const [body, setBody] = useState(initial?.body ?? "");
  const [error, setError] = useState<string | null>(null);
  // Inline two-step delete: matches the pattern in ReplyThread so we never
  // pop a native confirm() that breaks focus and looks foreign in the modal.
  const [armedDelete, setArmedDelete] = useState(false);
  // Edit-in-place when the source is "user". When initial is a library
  // prompt, save creates a user-prompt copy that overrides the library one.
  const isFork = initial?.source === "library";
  const isEditing = initial?.source === "user";
  const fixedId = isEditing ? initial!.id : null;

  // The id for the saved prompt:
  // - editing: keep original id (immutable across edits)
  // - forking: keep original id so the user copy overrides the library one
  // - new: derive from name on save
  const previewId = useMemo(() => {
    if (fixedId) return fixedId;
    if (isFork) return initial!.id;
    return slugifyId(name);
  }, [fixedId, isFork, initial, name]);

  const previewArgs = useMemo(() => {
    const filled: Record<string, string> = {};
    for (const a of args) {
      filled[a.name] =
        resolveAuto(a.auto, context) ?? `<${a.name}>`;
    }
    return filled;
  }, [args, context]);

  const previewText = useMemo(() => {
    try {
      return renderTemplate(body, previewArgs);
    } catch {
      return body;
    }
  }, [body, previewArgs]);

  function updateArg(idx: number, patch: Partial<PromptArg>): void {
    setArgs((prev) =>
      prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)),
    );
  }
  function addArg(): void {
    setArgs((prev) => [
      ...prev,
      { name: `arg${prev.length + 1}`, required: false },
    ]);
  }
  function removeArg(idx: number): void {
    setArgs((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSave(): void {
    setError(null);
    const draft: PromptDraft = {
      id: previewId,
      name: name.trim(),
      description: description.trim(),
      args: args.map((a) => ({
        name: a.name.trim(),
        required: a.required,
        ...(a.auto ? { auto: a.auto } : {}),
        ...(a.description?.trim() ? { description: a.description.trim() } : {}),
      })),
      body,
    };
    try {
      const saved = saveUserPrompt(draft);
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleDelete(): void {
    if (!fixedId || !onDeleted) return;
    deleteUserPrompt(fixedId);
    onDeleted(fixedId);
  }

  const banner = isFork
    ? `forking library prompt "${initial!.name}" — saving creates a user copy that overrides it.`
    : isEditing
      ? "editing your prompt."
      : "new prompt.";

  return (
    <section className="modal__sec">
      <div className="editor__banner">{banner}</div>

      <label className="editor__row">
        <span className="editor__label">name</span>
        <input
          className="picker__arg-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Security review this hunk"
        />
      </label>
      <div className="editor__hint">id: <code>{previewId}</code></div>

      <label className="editor__row">
        <span className="editor__label">description</span>
        <input
          className="picker__arg-input"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short summary shown in the picker"
        />
      </label>

      <div className="editor__sec-h">args</div>
      {args.length === 0 && (
        <div className="editor__empty">no args yet — add one below if your prompt template needs values.</div>
      )}
      {args.map((a, idx) => (
        <div key={idx} className="editor__arg">
          <input
            className="picker__arg-input editor__arg-name"
            type="text"
            value={a.name}
            onChange={(e) => updateArg(idx, { name: e.target.value })}
            placeholder="argname"
          />
          <select
            className="editor__arg-auto"
            value={a.auto ?? ""}
            onChange={(e) =>
              updateArg(idx, { auto: e.target.value || undefined })
            }
          >
            {AUTO_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                auto: {o.label}
              </option>
            ))}
          </select>
          <label className="editor__arg-req">
            <input
              type="checkbox"
              checked={a.required}
              onChange={(e) => updateArg(idx, { required: e.target.checked })}
            />
            required
          </label>
          <button
            type="button"
            className="modal__btn editor__arg-rm"
            onClick={() => removeArg(idx)}
            title="remove arg"
            aria-label={`remove arg ${a.name || idx + 1}`}
          >
            ×
          </button>
        </div>
      ))}
      <div className="editor__row editor__row--end">
        <button className="modal__btn" onClick={addArg}>
          + add arg
        </button>
      </div>

      <div className="editor__sec-h">body</div>
      <textarea
        className="editor__body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={"Use {{argname}} for substitutions and {{#argname}}…{{/argname}} for conditional blocks."}
        rows={10}
      />

      <div className="editor__sec-h">preview (rendered against current selection)</div>
      <pre className="editor__preview">{previewText || " "}</pre>

      {error && (
        <div className="modal__err errrow">
          <span className="errrow__msg">{error}</span>
          <CopyButton text={error} />
        </div>
      )}

      <div className="picker__actions">
        {isEditing && onDeleted && (
          armedDelete ? (
            <span
              className="editor__confirm"
              role="group"
              aria-label="confirm delete"
            >
              <span className="editor__confirm-q">
                delete &quot;{name || fixedId}&quot;?
              </span>
              <button
                type="button"
                className="editor__confirm-yes"
                onClick={() => {
                  setArmedDelete(false);
                  handleDelete();
                }}
                autoFocus
              >
                yes
              </button>
              <button
                type="button"
                className="editor__confirm-no"
                onClick={() => setArmedDelete(false)}
              >
                cancel
              </button>
            </span>
          ) : (
            <button
              className="modal__btn editor__delete"
              onClick={() => setArmedDelete(true)}
            >
              delete
            </button>
          )
        )}
        <span className="editor__spacer" />
        <button
          className="modal__btn"
          onClick={() => {
            setArmedDelete(false);
            onCancel();
          }}
        >
          cancel
        </button>
        <button
          className="modal__btn modal__btn--primary"
          onClick={handleSave}
        >
          save
        </button>
      </div>
    </section>
  );
}
