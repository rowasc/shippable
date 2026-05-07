import "./RangePicker.css";
import { useEffect, useState } from "react";
import type { CommitInfo, LoadOpts } from "../worktreeChangeset";

interface Props {
  worktreePath: string;
  fetchCommits: (path: string, limit?: number) => Promise<CommitInfo[]>;
  defaultFromRef?: string;
  defaultToRef?: string;
  defaultIncludeDirty?: boolean;
  onApply: (opts: LoadOpts) => void;
  onCancel: () => void;
  onJustThis: (sha: string) => void;
  busy?: boolean;
}

const HEAD = "HEAD";

export function RangePicker({
  worktreePath,
  fetchCommits,
  defaultFromRef,
  defaultToRef,
  defaultIncludeDirty,
  onApply,
  onCancel,
  onJustThis,
  busy,
}: Props) {
  const [commits, setCommits] = useState<CommitInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fromRef, setFromRef] = useState<string>(defaultFromRef ?? "");
  const [toRef, setToRefRaw] = useState<string>(defaultToRef ?? HEAD);
  const [includeDirty, setIncludeDirty] = useState<boolean>(
    defaultIncludeDirty ?? false,
  );

  useEffect(() => {
    let cancelled = false;
    fetchCommits(worktreePath)
      .then((list) => {
        if (cancelled) return;
        setCommits(list);
        // Default `from` to the latest commit if the caller didn't preselect.
        if (!defaultFromRef && list.length > 0) {
          setFromRef(list[0]!.sha);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [worktreePath, fetchCommits, defaultFromRef]);

  // Force-clear the dirty toggle whenever toRef leaves HEAD — uncommitted
  // changes are only meaningful when the range ends at the working tree.
  function setToRef(next: string) {
    setToRefRaw(next);
    if (next !== HEAD) setIncludeDirty(false);
  }

  function handleRowClick(commit: CommitInfo, ev: React.MouseEvent) {
    if (ev.shiftKey) {
      setToRef(commit.sha);
    } else {
      setFromRef(commit.sha);
    }
  }

  const dirtyDisabled = toRef !== HEAD;
  const canApply = !!fromRef && !!toRef && !busy;
  const fromShort = shortRef(fromRef);
  const toShort = toRef === HEAD ? HEAD : shortRef(toRef);

  return (
    <div
      className="range-picker"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="range-picker__refs">
        <span className="range-picker__ref-label">from:</span>
        <code className="range-picker__ref">{fromShort || "—"}</code>
        <span className="range-picker__ref-label">to:</span>
        <code className="range-picker__ref">{toShort || "—"}</code>
        {toRef !== HEAD && (
          <button
            type="button"
            className="range-picker__reset"
            onClick={() => setToRef(HEAD)}
          >
            reset to HEAD
          </button>
        )}
      </div>

      <label
        className={
          "range-picker__dirty" +
          (dirtyDisabled ? " range-picker__dirty--disabled" : "")
        }
        title={
          dirtyDisabled
            ? "Uncommitted changes are only available when the range ends at HEAD"
            : undefined
        }
      >
        <input
          type="checkbox"
          checked={includeDirty}
          disabled={dirtyDisabled}
          onChange={(e) => setIncludeDirty(e.target.checked)}
        />
        include uncommitted changes
      </label>

      <p className="range-picker__hint">
        Click a commit to set <strong>from</strong>, shift-click to set{" "}
        <strong>to</strong>. Use <em>just this</em> to review a single commit.
      </p>

      {err && <p className="range-picker__err">{err}</p>}
      {!commits && !err && (
        <p className="range-picker__loading">loading commits…</p>
      )}

      {commits && commits.length > 0 && (
        <ul className="range-picker__list">
          {commits.map((c, i) => {
            const isFrom = c.sha === fromRef;
            const isTo = c.sha === toRef;
            const inRange = inclusiveBetween(commits, fromRef, toRef, i);
            return (
              <li
                key={c.sha}
                className={
                  "range-picker__row" +
                  (isFrom ? " range-picker__row--from" : "") +
                  (isTo ? " range-picker__row--to" : "") +
                  (inRange ? " range-picker__row--in" : "")
                }
              >
                <button
                  type="button"
                  className="range-picker__pick"
                  onClick={(e) => handleRowClick(c, e)}
                >
                  <span className="range-picker__sha">{c.shortSha}</span>
                  <span className="range-picker__subject">{c.subject}</span>
                  {(isFrom || isTo) && (
                    <span className="range-picker__chip">
                      {isFrom && isTo ? "from + to" : isFrom ? "from" : "to"}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="range-picker__just"
                  onClick={() => onJustThis(c.sha)}
                  disabled={busy}
                >
                  just this
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="range-picker__actions">
        <button
          type="button"
          className="range-picker__btn range-picker__btn--primary"
          disabled={!canApply}
          onClick={() =>
            onApply({ kind: "range", fromRef, toRef, includeDirty })
          }
        >
          {busy ? "loading…" : "load range"}
        </button>
        <button
          type="button"
          className="range-picker__btn"
          onClick={onCancel}
          disabled={busy}
        >
          cancel
        </button>
      </div>
    </div>
  );
}

function shortRef(ref: string): string {
  if (!ref) return "";
  if (ref === HEAD) return HEAD;
  return ref.length > 7 ? ref.slice(0, 7) : ref;
}

// Highlight rows between `from` and `to` (inclusive) in the commit list.
// `to === HEAD` is treated as the topmost row.
function inclusiveBetween(
  commits: CommitInfo[],
  fromRef: string,
  toRef: string,
  i: number,
): boolean {
  if (!fromRef || !toRef) return false;
  const fromIdx = commits.findIndex((c) => c.sha === fromRef);
  const toIdx =
    toRef === HEAD ? 0 : commits.findIndex((c) => c.sha === toRef);
  if (fromIdx < 0 || toIdx < 0) return false;
  const lo = Math.min(fromIdx, toIdx);
  const hi = Math.max(fromIdx, toIdx);
  return i >= lo && i <= hi;
}
