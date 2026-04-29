import "./Sidebar.css";
import type { SidebarViewModel } from "../view";

interface Props {
  viewModel: SidebarViewModel;
  onPickFile: (fileId: string) => void;
  onToggleSkill: (skillId: string) => void;
}

export function Sidebar({ viewModel, onPickFile, onToggleSkill }: Props) {
  return (
    <aside className="sidebar">
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

      <section className="panel">
        <header className="panel__h">
          Skills <span className="panel__sub">contextual</span>
        </header>
        <ul className="panel__list">
          {viewModel.skills.map((s) => (
            <li key={s.id}>
              <button
                className={`row ${s.active ? "row--skill-on" : ""}`}
                onClick={() => onToggleSkill(s.id)}
                title={s.reason}
              >
                <span className="row__checkbox">{s.active ? "[x]" : "[ ]"}</span>
                <span className="row__label">{s.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
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
