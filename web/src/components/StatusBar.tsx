import type { Cursor, DiffFile, Hunk, PullRequest } from "../types";

interface Props {
  pr: PullRequest;
  file: DiffFile;
  hunk: Hunk;
  cursor: Cursor;
  coverage: number;
}

export function StatusBar({ pr, file, hunk, cursor, coverage }: Props) {
  const fileIdx = pr.files.findIndex((f) => f.id === file.id);
  const hunkIdx = file.hunks.findIndex((h) => h.id === hunk.id);
  return (
    <footer className="statusbar">
      <span className="statusbar__cell">
        line {cursor.lineIdx + 1}/{hunk.lines.length}
      </span>
      <span className="statusbar__cell">
        hunk {hunkIdx + 1}/{file.hunks.length}
      </span>
      <span className="statusbar__cell">
        file {fileIdx + 1}/{pr.files.length}
      </span>
      <span className="statusbar__cell statusbar__cell--cov">
        pr reviewed {Math.round(coverage * 100)}%
      </span>
      <span className="statusbar__spacer" />
      <span className="statusbar__hint">
        j/k line · J/K hunk · Tab file · a ack · c comment · ? help
      </span>
    </footer>
  );
}
