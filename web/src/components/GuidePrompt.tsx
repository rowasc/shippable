import type { GuideSuggestion } from "../guide";
import type { Cursor } from "../types";
import type { SymbolIndex } from "../symbols";
import { RichText } from "./RichText";

export function GuidePrompt({
  suggestion,
  symbols,
  onJump,
}: {
  suggestion: GuideSuggestion;
  symbols: SymbolIndex;
  onJump: (c: Cursor) => void;
}) {
  return (
    <div className="guide" role="dialog" aria-label="Review suggestion">
      <div className="guide__head">
        <span className="guide__icon">▸</span> suggestion
      </div>
      <div className="guide__body">
        <RichText text={suggestion.reason} symbols={symbols} onJump={onJump} />
      </div>
      <div className="guide__actions">
        <kbd>Enter</kbd>/<kbd>y</kbd> jump · <kbd>Esc</kbd>/<kbd>n</kbd> dismiss
      </div>
    </div>
  );
}
