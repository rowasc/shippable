import type { ChangeSet, ReviewState } from "../types";
import { fileCoverage } from "../state";

interface Props {
  cs: ChangeSet;
  state: ReviewState;
  onPickFile: (fileId: string) => void;
  onToggleSkill: (skillId: string) => void;
}

export function Sidebar({ cs, state, onPickFile, onToggleSkill }: Props) {
  return (
    <aside className="sidebar">
      <section className="panel">
        <header className="panel__h">Files</header>
        <ul className="panel__list">
          {cs.files.map((f) => {
            const cov = fileCoverage(f, state.reviewedLines);
            const active = f.id === state.cursor.fileId;
            return (
              <li key={f.id}>
                <button
                  className={`row ${active ? "row--active" : ""}`}
                  onClick={() => onPickFile(f.id)}
                  title={f.path}
                >
                  <Meter value={cov} />
                  <span className={`row__status row__status--${f.status}`}>
                    {statusChar(f.status)}
                  </span>
                  <span className="row__label">{f.path}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="panel">
        <header className="panel__h">
          Skills <span className="panel__sub">contextual</span>
        </header>
        <ul className="panel__list">
          {cs.skills.map((s) => {
            const active = state.activeSkills.has(s.id);
            return (
              <li key={s.id}>
                <button
                  className={`row ${active ? "row--skill-on" : ""}`}
                  onClick={() => onToggleSkill(s.id)}
                  title={s.reason}
                >
                  <span className="row__checkbox">{active ? "[x]" : "[ ]"}</span>
                  <span className="row__label">{s.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </aside>
  );
}

function Meter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const blocks = Math.round(value * 4);
  const bar = "█".repeat(blocks) + "░".repeat(4 - blocks);
  return (
    <span
      className={`meter ${pct === 100 ? "meter--full" : ""}`}
      aria-label={`${pct}% reviewed`}
    >
      {bar} {pct.toString().padStart(3)}%
    </span>
  );
}

function statusChar(s: string): string {
  switch (s) {
    case "added":
      return "A";
    case "modified":
      return "M";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    default:
      return "?";
  }
}
