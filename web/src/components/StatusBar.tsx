import "./StatusBar.css";
import type { StatusBarViewModel } from "../view";

interface Props {
  viewModel: StatusBarViewModel;
}

export function StatusBar({ viewModel }: Props) {
  return (
    <footer className="statusbar">
      <span className="statusbar__cell">{viewModel.lineDisplay}</span>
      <span className="statusbar__cell">{viewModel.hunkDisplay}</span>
      <span className="statusbar__cell">{viewModel.fileDisplay}</span>
      <span className="statusbar__cell statusbar__cell--cov">
        {viewModel.coverageDisplay}
      </span>
      <span className="statusbar__spacer" />
      <span className="statusbar__hint">
        j/k line · J/K hunk · Tab file · a ack · c comment · ? help
      </span>
    </footer>
  );
}
