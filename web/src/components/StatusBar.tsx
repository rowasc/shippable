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
      <span
        className="statusbar__cell statusbar__cell--read"
        title="cursor visits — auto-tracked"
      >
        {viewModel.readDisplay}
      </span>
      <span
        className="statusbar__cell statusbar__cell--cov"
        title="files signed off via Shift+M"
      >
        {viewModel.filesDisplay}
      </span>
      <span className="statusbar__spacer" />
      {viewModel.selectionHint ? (
        <span className="statusbar__hint statusbar__hint--selection">
          {viewModel.selectionHint}
        </span>
      ) : (
        <span className="statusbar__hint">
          j/k line · Tab file · a ack · c comment · ⇧M sign off · i inspector · p plan · ? help
        </span>
      )}
    </footer>
  );
}
