import "./Sidebar.css";
import type { SidebarDetachedEntry, SidebarViewModel } from "../view";
import { PromptRunsPanel, type PromptRunView } from "./PromptRunsPanel";

interface Props {
  viewModel: SidebarViewModel;
  onPickFile: (fileId: string) => void;
  runs: PromptRunView[];
  onCloseRun: (id: string) => void;
  wide: boolean;
  onToggleWide: () => void;
}

export function Sidebar({
  viewModel,
  onPickFile,
  runs,
  onCloseRun,
  wide,
  onToggleWide,
}: Props) {
  return (
    <aside className="sidebar">
      <PromptRunsPanel
        runs={runs}
        onClose={onCloseRun}
        wide={wide}
        onToggleWide={onToggleWide}
      />
      <section className="panel">
        <header className="panel__h">Files</header>
        <ul className="panel__list">
          {viewModel.files.map((f) => (
            <li key={f.fileId}>
              <button
                className={`row ${f.isCurrent ? "row--active" : ""} ${
                  f.isReviewed ? "row--file-reviewed" : ""
                }`}
                onClick={() => onPickFile(f.fileId)}
                title={
                  f.isReviewed
                    ? `${f.path} — reviewed · read ${f.readPct}%`
                    : `${f.path} — read ${f.readPct}%`
                }
              >
                <span
                  className="row__check"
                  aria-label={f.isReviewed ? "reviewed" : "not reviewed"}
                >
                  {f.isReviewed ? "✓" : " "}
                </span>
                <Meter readPct={f.readPct} meterBar={f.meterBar} />
                <span className={`row__status row__status--${f.status}`}>
                  {f.statusChar}
                </span>
                <span className="row__label">{f.path}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {viewModel.detached.length > 0 && (
        <section className="panel">
          <header className="panel__h">Detached</header>
          <ul className="panel__list panel__list--detached">
            {viewModel.detached.map((group) => (
              <li key={group.path} className="detached-group">
                <div className="detached-group__path">{group.path}</div>
                <ul className="detached-group__entries">
                  {group.entries.map((entry) => (
                    <DetachedEntryRow key={entry.id} entry={entry} />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}

function DetachedEntryRow({ entry }: { entry: SidebarDetachedEntry }) {
  const caption =
    entry.originType === "dirty"
      ? `from uncommitted edits at ${entry.authoredHHMM}`
      : `committed${entry.originSha7 ? ` at ${entry.originSha7}` : ""}`;
  return (
    <li className="detached-entry">
      <div className="detached-entry__body">{entry.body}</div>
      {entry.snippetLines.length > 0 && (
        <pre className="detached-entry__snippet">
          {entry.snippetLines
            .map((l) => `${l.sign} ${l.text}`)
            .join("\n")}
        </pre>
      )}
      <div className="detached-entry__caption">
        <span>{caption}</span>
        {entry.originType === "committed" && entry.originSha7 && (
          <button
            type="button"
            className="detached-entry__view-at"
            // Slice (e) of docs/plans/worktree-live-reload.md wires this
            // up. Keeping the affordance visible now makes the detached UX
            // feel real even though clicking it is a no-op for now.
            onClick={() => undefined}
            disabled
            title="view at this sha (coming soon)"
          >
            view at {entry.originSha7}
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * Meter shows the reviewer's reading progress as an 8-block bar plus a
 * percentage. Reading is a "where have I been" signal — never a verdict —
 * so the bar is always neutral; the verdict (reviewed) is communicated
 * separately by the file-row tint and the leading checkmark.
 */
function Meter({ readPct, meterBar }: { readPct: number; meterBar: string }) {
  return (
    <span className="meter" aria-label={`${readPct}% read`}>
      <span className="meter__bar">{meterBar}</span>
      <span className="meter__pct">{readPct.toString().padStart(3)}%</span>
    </span>
  );
}
