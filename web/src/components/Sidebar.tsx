import { useEffect, useRef, useState } from "react";
import "./Sidebar.css";
import type { SidebarDetachedEntry, SidebarViewModel } from "../view";
import { PromptRunsPanel, type PromptRunView } from "./PromptRunsPanel";
import { CodeText } from "./CodeText";
import { fetchFileAt } from "../fileAt";
import { guessLanguage } from "../parseDiff";

interface Props {
  viewModel: SidebarViewModel;
  onPickFile: (fileId: string) => void;
  runs: PromptRunView[];
  onCloseRun: (id: string) => void;
  wide: boolean;
  onToggleWide: () => void;
  /**
   * Worktree path the detached comments came from. Required to wire the
   * "view at <sha7>" affordance on committed entries — null disables the
   * affordance (legacy / non-worktree changesets).
   */
  worktreePath?: string | null;
}

export function Sidebar({
  viewModel,
  onPickFile,
  runs,
  onCloseRun,
  wide,
  onToggleWide,
  worktreePath,
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
          <header
            className="panel__h"
            title="comments left on lines that no longer exist in this diff (the file was rewritten or moved). Use 'view at' to see the line at the original commit."
          >
            Detached
            <span className="panel__h-hint">
              comments without a target line
            </span>
          </header>
          <ul className="panel__list panel__list--detached">
            {viewModel.detached.map((group) => (
              <li key={group.path} className="detached-group">
                <div className="detached-group__path">{group.path}</div>
                <ul className="detached-group__entries">
                  {group.entries.map((entry) => (
                    <DetachedEntryRow
                      key={entry.id}
                      entry={entry}
                      worktreePath={worktreePath ?? null}
                    />
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

function DetachedEntryRow({
  entry,
  worktreePath,
}: {
  entry: SidebarDetachedEntry;
  worktreePath: string | null;
}) {
  const caption =
    entry.originType === "dirty"
      ? `from uncommitted edits at ${entry.authoredHHMM}`
      : `committed${entry.originSha7 ? ` at ${entry.originSha7}` : ""}`;
  const canViewAt =
    entry.originType === "committed" &&
    !!entry.originSha &&
    !!entry.anchorPath &&
    !!worktreePath;
  const [open, setOpen] = useState(false);
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
        {canViewAt && (
          <button
            type="button"
            className="detached-entry__view-at"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            title={`view ${entry.anchorPath} at ${entry.originSha7}`}
          >
            {open ? "hide" : "view at"} {entry.originSha7}
          </button>
        )}
      </div>
      {open && canViewAt && (
        <ViewAtPanel
          worktreePath={worktreePath!}
          sha={entry.originSha}
          file={entry.anchorPath}
          anchorLineNo={entry.anchorLineNo}
        />
      )}
    </li>
  );
}

interface ViewAtPanelProps {
  worktreePath: string;
  sha: string;
  file: string;
  anchorLineNo?: number;
}

/**
 * Inline panel rendering a file at a specific commit. Fetches once on mount
 * via /api/worktrees/file-at and scrolls the anchor line into the middle of
 * the scroll viewport. Sized to a fixed height so a long file doesn't
 * dominate the sidebar; the user scrolls within the panel.
 */
function ViewAtPanel({ worktreePath, sha, file, anchorLineNo }: ViewAtPanelProps) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ok"; lines: string[] }
    | { kind: "err"; message: string }
  >({ kind: "loading" });
  const anchorRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFileAt({ worktreePath, sha, file })
      .then((content) => {
        if (cancelled) return;
        const lines = splitLines(content);
        setState({ kind: "ok", lines });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: "err", message });
      });
    return () => {
      cancelled = true;
    };
  }, [worktreePath, sha, file]);

  useEffect(() => {
    if (state.kind !== "ok") return;
    const el = anchorRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "center" });
  }, [state.kind]);

  if (state.kind === "loading") {
    return (
      <div className="view-at-panel view-at-panel--status">loading…</div>
    );
  }
  if (state.kind === "err") {
    return (
      <div className="view-at-panel view-at-panel--status view-at-panel--err">
        couldn’t load: {state.message}
      </div>
    );
  }

  const language = guessLanguage(file);
  return (
    <div className="view-at-panel">
      <pre className="view-at-panel__code">
        {state.lines.map((text, i) => {
          const lineNo = i + 1;
          const isAnchor = anchorLineNo === lineNo;
          return (
            <span
              key={i}
              ref={isAnchor ? anchorRef : null}
              className={`view-at-line ${isAnchor ? "view-at-line--anchor" : ""}`}
            >
              <span className="view-at-line__no">{lineNo}</span>
              <span className="view-at-line__text">
                <CodeText text={text} language={language} />
              </span>
              {"\n"}
            </span>
          );
        })}
      </pre>
    </div>
  );
}

function splitLines(content: string): string[] {
  const lines = content.split("\n");
  // `git show` content always carries the file's trailing newline; split
  // leaves a stray empty entry — drop it so the line count matches what a
  // user expects.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
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
