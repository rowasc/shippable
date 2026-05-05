import "./HelpOverlay.css";
import { KEYMAP, type KeyGroup } from "../keymap";

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
function chordLabel(key: string, shift?: boolean): string {
  if (shift) {
    const base = key.length === 1 ? key.toLowerCase() : keyLabel(key);
    return `⇧${base}`;
  }
  return keyLabel(key);
}

/** Collect unique display rows per action within a group. */
function groupRows(group: KeyGroup): { chord: string; label: string }[] {
  const seen = new Map<string, string[]>();
  for (const entry of KEYMAP) {
    if (entry.group !== group) continue;
    // Group by (action, label) so aliased keys merge into one row.
    const rowKey = `${entry.action}|${entry.label}`;
    if (!seen.has(rowKey)) seen.set(rowKey, []);
    seen.get(rowKey)!.push(chordLabel(entry.key, entry.shift));
  }
  return Array.from(seen.entries()).map(([rowKey, chords]) => ({
    chord: chords.join("/"),
    label: rowKey.split("|")[1],
  }));
}

const MAIN_GROUPS: KeyGroup[] = ["navigation", "review", "guide", "ui"];

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  const mainRows = MAIN_GROUPS.flatMap((g) => groupRows(g));
  const testingRows = groupRows("testing");

  return (
    <div className="help" onClick={onClose}>
      <div className="help__box" onClick={(e) => e.stopPropagation()}>
        <div className="help__title">keybindings</div>
        <table className="help__table">
          <tbody>
            {mainRows.map(({ chord, label }) => (
              <tr key={chord + label}>
                <td>
                  {chord.split("/").map((part, i) => (
                    <span key={part}>
                      {i > 0 && "/"}
                      <kbd>{part}</kbd>
                    </span>
                  ))}
                </td>
                <td>{label}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="help__title help__title--sub">testing</div>
        <table className="help__table">
          <tbody>
            {testingRows.map(({ chord, label }) => (
              <tr key={chord + label}>
                <td>
                  {chord.split("/").map((part, i) => (
                    <span key={part}>
                      {i > 0 && "/"}
                      <kbd>{part}</kbd>
                    </span>
                  ))}
                </td>
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
      </div>
    </div>
  );
}
