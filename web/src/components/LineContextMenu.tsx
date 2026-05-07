import "./LineContextMenu.css";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface ContextMenuItem {
  id: string;
  label: string;
  /** Keyboard shortcut for the parallel keyboard path; rendered as <kbd>. */
  shortcut?: string;
  enabled: boolean;
  onSelect: () => void;
}

interface Props {
  /** Viewport coordinates from the contextmenu event. */
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function LineContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLUListElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [activeIdx, setActiveIdx] = useState<number>(() =>
    items.findIndex((i) => i.enabled),
  );

  // Reposition on mount so the menu stays inside the viewport. Measuring
  // requires the element be in the DOM, so layout effect not effect.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    const margin = 4;
    if (nx + rect.width + margin > window.innerWidth) {
      nx = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (ny + rect.height + margin > window.innerHeight) {
      ny = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    if (nx !== x || ny !== y) setPos({ x: nx, y: ny });
  }, [x, y]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!ref.current) return;
      if (ref.current.contains(event.target as Node)) return;
      onClose();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" || event.key === "Tab") {
        // Tab lets the user move focus on; the menu shouldn't linger over
        // background content once focus has moved.
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIdx((i) => nextEnabled(items, i, 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIdx((i) => nextEnabled(items, i, -1));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const item = items[activeIdx];
        if (item?.enabled) {
          item.onSelect();
          onClose();
        }
      }
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [items, activeIdx, onClose]);

  return (
    <ul
      ref={ref}
      className="line-context-menu"
      role="menu"
      aria-label="Line actions"
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((item, idx) => (
        <li
          key={item.id}
          role="menuitem"
          aria-disabled={!item.enabled}
          className={`line-context-menu__item ${
            !item.enabled ? "line-context-menu__item--disabled" : ""
          } ${idx === activeIdx ? "line-context-menu__item--active" : ""}`}
          onMouseEnter={() => item.enabled && setActiveIdx(idx)}
          onClick={() => {
            if (!item.enabled) return;
            item.onSelect();
            onClose();
          }}
        >
          <span className="line-context-menu__label">{item.label}</span>
          {item.shortcut && (
            <kbd className="line-context-menu__kbd">{item.shortcut}</kbd>
          )}
        </li>
      ))}
    </ul>
  );
}

function nextEnabled(items: ContextMenuItem[], from: number, delta: number): number {
  const n = items.length;
  if (n === 0) return from;
  for (let step = 1; step <= n; step++) {
    const i = (from + delta * step + n) % n;
    if (items[i].enabled) return i;
  }
  return from;
}
