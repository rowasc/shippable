import "./LoadModal.css";
import "./PromptPicker.css";
import "./CommandPalette.css";
import { useMemo, useState } from "react";
import { KEYMAP, type ActionId, type KeyEntry, type KeyGroup } from "../keymap";

export interface CommandItem {
  action: ActionId;
  label: string;
  group: KeyGroup;
  chord: string;
  enabled: boolean;
}

interface Props {
  predicates: Record<string, boolean>;
  onClose: () => void;
  onPick: (action: ActionId) => void;
}

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

function chordLabel(entry: KeyEntry): string {
  const parts: string[] = [];
  if (entry.meta) parts.push("⌘");
  if (entry.ctrl) parts.push("⌃");
  if (entry.shift) {
    const base = entry.key.length === 1 ? entry.key.toLowerCase() : keyLabel(entry.key);
    return parts.join("") + `⇧${base}`;
  }
  return parts.join("") + keyLabel(entry.key);
}

function buildCommandItems(predicates: Record<string, boolean>): CommandItem[] {
  const map = new Map<string, CommandItem>();
  for (const entry of KEYMAP) {
    if (entry.palette !== "global") continue;
    const key = `${entry.action}|${entry.label}`;
    const chord = chordLabel(entry);
    const enabled = entry.when === undefined ? true : !!predicates[entry.when];
    const existing = map.get(key);
    if (existing) {
      existing.chord = `${existing.chord} / ${chord}`;
      existing.enabled = existing.enabled || enabled;
    } else {
      map.set(key, {
        action: entry.action,
        label: entry.label,
        group: entry.group,
        chord,
        enabled,
      });
    }
  }
  return Array.from(map.values());
}

export function CommandPalette({ predicates, onClose, onPick }: Props) {
  const items = useMemo(() => buildCommandItems(predicates), [predicates]);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.group.toLowerCase().includes(q) ||
        i.chord.toLowerCase().includes(q),
    );
  }, [items, query]);

  const enabledFiltered = useMemo(
    () => filtered.filter((i) => i.enabled),
    [filtered],
  );

  // Clamp active index when the filtered set shrinks beneath it.
  const clampedActiveIdx = Math.min(
    activeIdx,
    Math.max(0, enabledFiltered.length - 1),
  );

  function pickAt(idx: number) {
    const item = enabledFiltered[idx];
    if (!item) return;
    onPick(item.action);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => {
        const max = Math.max(0, enabledFiltered.length - 1);
        return Math.min(max, i + 1);
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pickAt(clampedActiveIdx);
    }
  }

  return (
    <div className="modal" onClick={onClose}>
      <div
        className="modal__box cmdpal__box"
        role="dialog"
        aria-modal="true"
        aria-label="command palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKey}
      >
        <header className="modal__h">
          <span className="modal__h-label">command palette</span>
          <button className="modal__close" onClick={onClose}>
            × close
          </button>
        </header>
        <section className="modal__sec">
          <input
            className="picker__search"
            type="text"
            placeholder="search app actions…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            autoFocus
          />
        </section>
        <section className="modal__sec cmdpal__results">
          {filtered.length === 0 ? (
            <div className="picker__empty">
              {query.trim()
                ? `No commands match "${query.trim()}".`
                : "No commands available."}
            </div>
          ) : (
            <ul className="cmdpal__list">
              {filtered.map((item) => {
                const enabledIdx = item.enabled
                  ? enabledFiltered.indexOf(item)
                  : -1;
                const isActive = enabledIdx === clampedActiveIdx;
                return (
                  <li
                    key={item.action + "|" + item.label}
                    className={
                      "cmdpal__item" +
                      (isActive ? " cmdpal__item--active" : "") +
                      (item.enabled ? "" : " cmdpal__item--disabled")
                    }
                    onClick={() => {
                      if (item.enabled) onPick(item.action);
                    }}
                    onMouseMove={() => {
                      if (enabledIdx >= 0 && enabledIdx !== clampedActiveIdx) {
                        setActiveIdx(enabledIdx);
                      }
                    }}
                  >
                    <span className="cmdpal__chord">{item.chord}</span>
                    <span className="cmdpal__label">{item.label}</span>
                    <span className="cmdpal__group">{item.group}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
