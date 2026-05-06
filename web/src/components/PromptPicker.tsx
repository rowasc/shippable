import "./LoadModal.css";
import "./PromptPicker.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  type Prompt,
  type AutoFillContext,
  listPrompts,
  renderTemplate,
  resolveAuto,
} from "../promptStore";
import { PromptEditor } from "./PromptEditor";
import { CopyButton } from "./CopyButton";

type View =
  | { kind: "list" }
  | { kind: "form"; prompt: Prompt }
  | { kind: "editor"; initial: Prompt | null };

interface Props {
  context: AutoFillContext;
  onClose: () => void;
  onSubmit: (prompt: Prompt, rendered: string) => void;
}

export function PromptPicker({ context, onClose, onSubmit }: Props) {
  const [prompts, setPrompts] = useState<Prompt[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>({ kind: "list" });

  const reload = useCallback((): void => {
    setPrompts(null);
    listPrompts()
      .then(setPrompts)
      .catch((err: unknown) =>
        setLoadError(err instanceof Error ? err.message : String(err)),
      );
  }, []);

  useEffect(() => {
    let alive = true;
    listPrompts()
      .then((list) => {
        if (alive) setPrompts(list);
      })
      .catch((err: unknown) => {
        if (alive) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!prompts) return [];
    const q = query.trim().toLowerCase();
    if (!q) return prompts;
    return prompts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q),
    );
  }, [prompts, query]);

  const headerLabel =
    view.kind === "form"
      ? `prompt · ${view.prompt.name}`
      : view.kind === "editor"
        ? view.initial
          ? view.initial.source === "library"
            ? `fork · ${view.initial.name}`
            : `edit · ${view.initial.name}`
          : "new prompt"
        : "run a prompt";

  return (
    <div className="modal" onClick={onClose}>
      <div
        className="modal__box"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Catch Escape locally — the global keymap handler bails out on
          // INPUT/TEXTAREA targets, so the picker's own form fields would
          // otherwise swallow it.
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="modal__h">
          <span className="modal__h-label">{headerLabel}</span>
          <button className="modal__close" onClick={onClose}>
            × close
          </button>
        </header>

        {view.kind === "list" && (
          <PromptList
            prompts={filtered}
            query={query}
            onQuery={setQuery}
            onPick={(p) => setView({ kind: "form", prompt: p })}
            onEdit={(p) => setView({ kind: "editor", initial: p })}
            onNew={() => setView({ kind: "editor", initial: null })}
            loading={prompts === null && !loadError}
            error={loadError}
          />
        )}
        {view.kind === "form" && (
          <PromptForm
            prompt={view.prompt}
            context={context}
            onBack={() => setView({ kind: "list" })}
            onSubmit={(rendered) => onSubmit(view.prompt, rendered)}
          />
        )}
        {view.kind === "editor" && (
          <PromptEditor
            initial={view.initial}
            context={context}
            onCancel={() => setView({ kind: "list" })}
            onSaved={() => {
              reload();
              setView({ kind: "list" });
            }}
            onDeleted={
              view.initial?.source === "user"
                ? () => {
                    reload();
                    setView({ kind: "list" });
                  }
                : undefined
            }
          />
        )}
      </div>
    </div>
  );
}

interface ListProps {
  prompts: Prompt[];
  query: string;
  onQuery: (q: string) => void;
  onPick: (p: Prompt) => void;
  onEdit: (p: Prompt) => void;
  onNew: () => void;
  loading: boolean;
  error: string | null;
}

function PromptList({
  prompts,
  query,
  onQuery,
  onPick,
  onEdit,
  onNew,
  loading,
  error,
}: ListProps) {
  return (
    <>
      <section className="modal__sec">
        <div className="picker__search-row">
          <input
            className="picker__search"
            type="text"
            placeholder="search prompts…"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && prompts.length > 0) {
                onPick(prompts[0]);
              }
            }}
          />
          <button
            className="modal__btn"
            onClick={onNew}
            title="create a new user prompt"
          >
            + new
          </button>
        </div>
      </section>
      <section className="modal__sec">
        {error && (
          <div className="modal__err errrow">
            <span className="errrow__msg">{error}</span>
            <CopyButton text={error} />
          </div>
        )}
        {loading && <div className="picker__empty">loading prompts…</div>}
        {!loading && !error && prompts.length === 0 && (
          <div className="picker__empty">no prompts match.</div>
        )}
        {prompts.length > 0 && (
          <ul className="picker__list">
            {prompts.map((p) => (
              <li
                key={p.id}
                className="picker__item"
                onClick={() => onPick(p)}
              >
                <span className="picker__item-name">{p.name}</span>
                {p.source === "user" && (
                  <span className="picker__item-badge">user</span>
                )}
                <button
                  className="picker__item-edit"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(p);
                  }}
                  title={p.source === "library" ? "fork into a user prompt" : "edit this prompt"}
                >
                  {p.source === "library" ? "fork" : "edit"}
                </button>
                <span className="picker__item-desc">{p.description}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

interface FormProps {
  prompt: Prompt;
  context: AutoFillContext;
  onBack: () => void;
  onSubmit: (rendered: string) => void;
}

function PromptForm({ prompt, context, onBack, onSubmit }: FormProps) {
  const initialValues = useMemo(() => {
    const initial: Record<string, string> = {};
    for (const a of prompt.args) {
      initial[a.name] = resolveAuto(a.auto, context) ?? "";
    }
    return initial;
  }, [prompt, context]);
  const [values, setValues] = useState<Record<string, string>>(initialValues);

  const missingRequired = prompt.args
    .filter((a) => a.required && (values[a.name] ?? "").trim().length === 0)
    .map((a) => a.name);

  function handleSubmit() {
    if (missingRequired.length > 0) return;
    const rendered = renderTemplate(prompt.body, values);
    onSubmit(rendered);
  }

  return (
    <section className="modal__sec">
      <div className="picker__form-desc">{prompt.description}</div>

      {prompt.args.map((arg) => {
        const isLong = !!arg.auto;
        const value = values[arg.name] ?? "";
        const sourceLabel = describeAutoSource(arg.auto, context);
        const edited = !!arg.auto && value !== initialValues[arg.name];
        return (
          <div key={arg.name} className="picker__arg">
            <label className="picker__arg-label">
              <span>{arg.name}</span>
              {arg.required && (
                <span className="picker__arg-required">required</span>
              )}
            </label>
            {sourceLabel && (
              <div className="picker__arg-source">
                {sourceLabel}
                {edited && <span className="picker__arg-edited"> · edited</span>}
              </div>
            )}
            {isLong ? (
              <textarea
                className="picker__arg-textarea"
                value={value}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [arg.name]: e.target.value }))
                }
                rows={6}
              />
            ) : (
              <input
                className="picker__arg-input"
                type="text"
                value={value}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [arg.name]: e.target.value }))
                }
              />
            )}
            {arg.description && (
              <div className="picker__arg-hint">{arg.description}</div>
            )}
          </div>
        );
      })}

      <div className="picker__actions">
        <button className="modal__btn" onClick={onBack}>
          ← back
        </button>
        <button
          className="modal__btn modal__btn--primary"
          onClick={handleSubmit}
          disabled={missingRequired.length > 0}
          title={
            missingRequired.length > 0
              ? `fill in: ${missingRequired.join(", ")}`
              : undefined
          }
        >
          run
        </button>
      </div>
    </section>
  );
}

function describeAutoSource(
  hint: string | undefined,
  ctx: AutoFillContext,
): ReactNode {
  if (!hint) return null;
  switch (hint) {
    case "selection": {
      const info = ctx.selectionInfo;
      if (info.kind === "lines") {
        const span = info.hi - info.lo + 1;
        return `auto-filled from your line selection — lines ${info.lo}–${info.hi} (${span} of ${info.hunkLines})`;
      }
      return `auto-filled from the current hunk — all ${info.hunkLines} lines (no line selection)`;
    }
    case "file":
      return "auto-filled with the current file path";
    case "changeset.title":
      return "auto-filled with the changeset title";
    case "changeset.diff":
      return "auto-filled with the full changeset diff";
    default:
      return "auto-filled";
  }
}

