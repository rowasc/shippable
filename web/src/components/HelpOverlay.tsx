import "./HelpOverlay.css";
import { KEYMAP, type KeyGroup } from "../keymap";

interface HelpContextRow {
  chord: string;
  label: string;
}

interface HelpContextSection {
  title: string;
  rows: HelpContextRow[];
  hint?: string;
}

/** Render a key name as a human-friendly label for <kbd>. */
function keyLabel(key: string): string {
  switch (key) {
    case "ArrowDown": return "↓";
    case "ArrowUp":   return "↑";
    case "Escape":    return "Esc";
    case "Enter":     return "Enter";
    case "Tab":       return "Tab";
    default:          return key;
  }
}

/**
 * Build a display string for a single KeyEntry's key chord. Shift is
 * always rendered as `⇧X` so the dialog stays consistent — the previous
 * "uppercase letters imply shift" branch put `M` next to `⇧Tab` in the
 * same table, which read as two different conventions.
 */
function chordLabel(
  key: string,
  {
    shift,
    meta,
    ctrl,
  }: { shift?: boolean; meta?: boolean; ctrl?: boolean } = {},
): string {
  const parts: string[] = [];
  if (meta) parts.push("⌘");
  if (ctrl) parts.push("⌃");
  if (shift) parts.push("⇧");
  const base = shift && key.length === 1 ? key.toLowerCase() : keyLabel(key);
  return parts.join("") + base;
}

/** Collect unique display rows per action within a group. */
function groupRows(group: KeyGroup): { chord: string; label: string }[] {
  const seen = new Map<string, string[]>();
  for (const entry of KEYMAP) {
    if (entry.group !== group) continue;
    // Group by (action, label) so aliased keys merge into one row.
    const rowKey = `${entry.action}|${entry.label}`;
    if (!seen.has(rowKey)) seen.set(rowKey, []);
    seen.get(rowKey)!.push(
      chordLabel(entry.key, {
        shift: entry.shift,
        meta: entry.meta,
        ctrl: entry.ctrl,
      }),
    );
  }
  return Array.from(seen.entries()).map(([rowKey, chords]) => ({
    chord: chords.join("/"),
    label: rowKey.split("|")[1],
  }));
}

const MAIN_GROUPS: KeyGroup[] = ["navigation", "review", "guide", "ui"];

function renderChord(chord: string) {
  return chord.split("/").map((part, i) => (
    <span key={part}>
      {i > 0 && "/"}
      <kbd>{part}</kbd>
    </span>
  ));
}

export function HelpOverlay({
  onClose,
  context,
}: {
  onClose: () => void;
  context?: HelpContextSection;
}) {
  const mainRows = MAIN_GROUPS.flatMap((g) => groupRows(g));
  const testingRows = groupRows("testing");

  return (
    <div className="help" onClick={onClose}>
      <div
        className="help__box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="help__head">
          <div className="help__title" id="help-title">keybindings</div>
          <button
            type="button"
            className="help__close"
            onClick={onClose}
            aria-label="close help"
          >
            × close
          </button>
        </div>
        {context && context.rows.length > 0 && (
          <>
            <div className="help__title help__title--sub">{context.title}</div>
            <table className="help__table">
              <tbody>
                {context.rows.map(({ chord, label }) => (
                  <tr key={chord + label}>
                    <td>{renderChord(chord)}</td>
                    <td>{label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {context.hint && <div className="help__hint">{context.hint}</div>}
            <div className="help__title help__title--sub">all shortcuts</div>
          </>
        )}
        <table className="help__table">
          <tbody>
            {mainRows.map(({ chord, label }) => (
              <tr key={chord + label}>
                <td>{renderChord(chord)}</td>
                <td>{label}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="help__title help__title--sub">gutter glyphs</div>
        <table className="help__table help__table--legend">
          <tbody>
            <tr>
              <td><span className="help__glyph help__glyph--warn">!</span></td>
              <td>AI flagged a warning on this line</td>
            </tr>
            <tr>
              <td><span className="help__glyph help__glyph--question">?</span></td>
              <td>AI has a question for you on this line</td>
            </tr>
            <tr>
              <td><span className="help__glyph help__glyph--info">i</span></td>
              <td>AI left an informational note</td>
            </tr>
            <tr>
              <td><span className="help__glyph">✓</span></td>
              <td>you acked the AI note (press <kbd>a</kbd> to toggle)</td>
            </tr>
            <tr>
              <td><span className="help__glyph">“</span></td>
              <td>your comment thread is on this line</td>
            </tr>
          </tbody>
        </table>
        <div className="help__title help__title--sub">testing</div>
        <table className="help__table">
          <tbody>
            {testingRows.map(({ chord, label }) => (
              <tr key={chord + label}>
                <td>{renderChord(chord)}</td>
                <td>{label}</td>
              </tr>
            ))}
            <tr>
              <td><code>?cs=&lt;id&gt;</code></td>
              <td>load a specific sample on boot</td>
            </tr>
          </tbody>
        </table>
        <div className="help__hint">
          Forgot a key? Press <kbd>⌘k</kbd> / <kbd>⌃k</kbd> to open the
          command palette and search app-level actions.
        </div>
        <div className="help__hint">
          Lines you visit are marked as <em>read</em>. Press{" "}
          <kbd>⇧m</kbd> to sign off the current file as reviewed.
        </div>
        <div className="help__foot">
          <kbd>Esc</kbd> to close
        </div>
      </div>
    </div>
  );
}
