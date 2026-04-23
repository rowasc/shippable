import "./GuidePrompt.css";
import type { Cursor } from "../types";
import type { GuidePromptViewModel, RichSegment } from "../view";

interface Props {
  viewModel: GuidePromptViewModel;
  onJump: (c: Cursor) => void;
}

export function GuidePrompt({ viewModel, onJump }: Props) {
  return (
    <div className="guide" role="dialog" aria-label="Review suggestion">
      <div className="guide__head">
        <span className="guide__icon">▸</span> suggestion
      </div>
      <div className="guide__body">
        {viewModel.segments.map((seg, i) => (
          <Segment key={i} seg={seg} onJump={onJump} />
        ))}
      </div>
      <div className="guide__actions">
        <kbd>Enter</kbd>/<kbd>y</kbd> jump · <kbd>Esc</kbd>/<kbd>n</kbd> dismiss
      </div>
    </div>
  );
}

function Segment({ seg, onJump }: { seg: RichSegment; onJump: (c: Cursor) => void }) {
  switch (seg.kind) {
    case "text":
      return <span>{seg.text}</span>;
    case "code":
      return <code className="rt-code">{seg.text}</code>;
    case "symbol":
      return (
        <button
          className="sym"
          onClick={() => onJump(seg.target)}
          title={`jump to ${seg.text}`}
        >
          {seg.text}
        </button>
      );
    case "code-symbol":
      return (
        <button
          className="sym sym--code"
          onClick={() => onJump(seg.target)}
          title={`jump to ${seg.text}`}
        >
          {seg.text}
        </button>
      );
  }
}
