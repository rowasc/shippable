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
                className={`row ${f.isCurrent ? "row--active" : ""}`}
                onClick={() => onPickFile(f.fileId)}
                title={f.path}
              >
                <Meter coveragePct={f.coveragePct} meterBar={f.meterBar} />
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

function Meter({ coveragePct, meterBar }: { coveragePct: number; meterBar: string }) {
  return (
    <span
      className={`meter ${coveragePct === 100 ? "meter--full" : ""}`}
      aria-label={`${coveragePct}% reviewed`}
    >
      {meterBar} {coveragePct.toString().padStart(3)}%
    </span>
  );
}
