import "./PromptResult.css";
import { CopyButton } from "./CopyButton";

export type PromptRunStatus = "streaming" | "done" | "error";

export interface PromptRunView {
  id: string;
  promptName: string;
  text: string;
  status: PromptRunStatus;
  error?: string;
}

interface Props {
  run: PromptRunView;
  onClose: () => void;
}

export function PromptResultCard({ run, onClose }: Props) {
  const statusLabel =
    run.status === "streaming"
      ? "streaming…"
      : run.status === "error"
        ? "error"
        : "done";
  return (
    <article className="promptresult-card">
      <header className="promptresult-card__h">
        <span className="promptresult-card__h-name">{run.promptName}</span>
        <span
          className={`promptresult-card__status promptresult-card__status--${run.status}`}
        >
          {statusLabel}
        </span>
        <button className="promptresult-card__close" onClick={onClose} title="dismiss this run">
          ×
        </button>
      </header>
      {run.text.length === 0 && run.status === "streaming" ? (
        <div className="promptresult-card__body promptresult-card__body--empty">
          waiting for first token…
        </div>
      ) : (
        <div className="promptresult-card__body">{run.text}</div>
      )}
      {run.status === "error" && run.error && (
        <div className="promptresult-card__err errrow">
          <span className="errrow__msg">{run.error}</span>
          <CopyButton text={run.error} />
        </div>
      )}
    </article>
  );
}

interface StackProps {
  runs: PromptRunView[];
  onClose: (id: string) => void;
}

export function PromptResultsStack({ runs, onClose }: StackProps) {
  if (runs.length === 0) return null;
  return (
    <aside className="promptresults">
      <header className="promptresults__h">
        <span className="promptresults__h-label">prompts</span>
        <span className="promptresults__h-count">{runs.length}</span>
      </header>
      <div className="promptresults__list">
        {runs.map((r) => (
          <PromptResultCard key={r.id} run={r} onClose={() => onClose(r.id)} />
        ))}
      </div>
    </aside>
  );
}
