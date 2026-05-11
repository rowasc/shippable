import "./TopbarActions.css";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface TopbarAction {
  id: string;
  /** Visible button label without the glyph (e.g. "inspector"). */
  label: string;
  /** Optional decorative glyph prefix (e.g. "◫", "▷", "+"). */
  glyph?: string;
  /** Keyboard shortcut hint shown as <kbd> alongside the label. */
  kbd?: string;
  /** Tooltip + accessible name source. */
  title: string;
  active?: boolean;
  danger?: boolean;
  /** Pinned items never collapse into the overflow menu. */
  pinned?: boolean;
  /** Higher priority survives longer; lower drops into overflow first. */
  priority: number;
  onClick: () => void;
}

interface Props {
  items: TopbarAction[];
  /** Optional leading element rendered before the action buttons (e.g. ThemePicker). Collapses into the overflow menu first. */
  leading?: {
    node: ReactNode;
    /** Label used when shown inside the overflow menu. */
    menuLabel: string;
  };
}

/**
 * Renders a row of action buttons that adapts to its available width using
 * a Priority+ pattern: when items don't fit, the lowest-priority ones drop
 * into a "more" kebab menu. Pinned items (e.g. destructive reset) stay
 * visible regardless of width.
 */
export function TopbarActions({ items, leading }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [overflowed, setOverflowed] = useState<Set<string>>(() => new Set());
  const [leadingOverflowed, setLeadingOverflowed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    const topbar = container?.closest<HTMLElement>(".topbar");
    if (!container || !measure || !topbar) return;
    // jsdom (test environment) has no ResizeObserver; degrade to "show all
    // items, no overflow" so component tests don't crash. Real browsers
    // always have it.
    if (typeof ResizeObserver === "undefined") return;

    let raf = 0;
    const recompute = () => {
      raf = 0;
      const GAP = 6;
      const KEBAB_W = 32;
      // Reserve the topbar's grid gap between metadata and actions columns
      // so the actions row can't claim every last pixel. Leave a sliver of
      // breathing room for the metadata column to render the brand + id.
      const METADATA_FLOOR = 120;
      const GRID_GAP = 8;

      const widths = new Map<string, number>();
      for (const el of measure.querySelectorAll<HTMLElement>("[data-measure-id]")) {
        widths.set(el.dataset.measureId!, el.getBoundingClientRect().width);
      }
      const leadingW = leading ? (widths.get("__leading__") ?? 0) : 0;

      const itemsTotal = items.reduce(
        (s, it, i) => s + (widths.get(it.id) ?? 0) + (i > 0 ? GAP : 0),
        0,
      );
      const allTotal = leadingW + (leading && items.length > 0 ? GAP : 0) + itemsTotal;
      // Use the topbar's width (not the actions container's) as the source
      // of truth — the actions container's clientWidth depends on which
      // items are rendered, which creates a feedback loop.
      const topbarStyles = window.getComputedStyle(topbar);
      const padX =
        parseFloat(topbarStyles.paddingLeft) +
        parseFloat(topbarStyles.paddingRight);
      const available = topbar.clientWidth - padX - GRID_GAP - METADATA_FLOOR;

      let nextOverflowed: Set<string>;
      let nextLeadingOverflowed: boolean;

      if (allTotal <= available) {
        nextOverflowed = new Set();
        nextLeadingOverflowed = false;
      } else {
        // Some items need to overflow. Reserve room for the kebab.
        const budget = available - KEBAB_W - GAP;

        // Drop the leading slot first (lowest priority of all).
        // Then drop items by ascending priority, pinned never drop.
        nextLeadingOverflowed = true;
        const sorted = [...items].sort((a, b) => {
          const ap = a.pinned ? 1 : 0;
          const bp = b.pinned ? 1 : 0;
          if (ap !== bp) return bp - ap;
          return b.priority - a.priority;
        });
        const visible = new Set<string>();
        let used = 0;
        for (const item of sorted) {
          const w = widths.get(item.id) ?? 0;
          const needed = used + (visible.size > 0 ? GAP : 0) + w;
          if (item.pinned || needed <= budget) {
            visible.add(item.id);
            used = needed;
          }
        }
        nextOverflowed = new Set(
          items.filter((it) => !visible.has(it.id)).map((it) => it.id),
        );

        // If after collapsing the leading + low-priority items everything
        // still fits without needing the kebab, restore the leading slot.
        if (nextOverflowed.size === 0 && leading) {
          const withLeading = leadingW + GAP + used;
          if (withLeading <= available) nextLeadingOverflowed = false;
        }
      }

      setOverflowed((prev) =>
        setEquals(prev, nextOverflowed) ? prev : nextOverflowed,
      );
      setLeadingOverflowed((prev) =>
        prev === nextLeadingOverflowed ? prev : nextLeadingOverflowed,
      );
    };

    const ro = new ResizeObserver(() => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(recompute);
    });
    ro.observe(topbar);
    recompute();
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [items, leading]);

  const visibleItems = items.filter((it) => !overflowed.has(it.id));
  const overflowItems = items.filter((it) => overflowed.has(it.id));
  const showKebab = overflowItems.length > 0 || (leadingOverflowed && !!leading);

  // Close the menu if its contents disappear (everything fits again).
  // Reset during render rather than in an effect to avoid a cascading render.
  if (!showKebab && menuOpen) setMenuOpen(false);

  return (
    <div ref={containerRef} className="topbar-actions">
      {leading && !leadingOverflowed && leading.node}
      {visibleItems.map((it) => (
        <ActionButton key={it.id} action={it} />
      ))}
      {showKebab && (
        <OverflowKebab
          items={overflowItems}
          leading={leadingOverflowed ? leading : undefined}
          open={menuOpen}
          onToggle={() => setMenuOpen((v) => !v)}
          onClose={() => setMenuOpen(false)}
        />
      )}
      <div ref={measureRef} className="topbar-actions__measure" aria-hidden="true">
        {leading && (
          <div data-measure-id="__leading__">{leading.node}</div>
        )}
        {items.map((it) => (
          <div key={it.id} data-measure-id={it.id}>
            <ActionButton action={it} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionButton({ action }: { action: TopbarAction }) {
  const cls = ["topbar__btn"];
  if (action.active) cls.push("topbar__btn--on");
  if (action.danger) cls.push("topbar__btn--danger");
  return (
    <button
      type="button"
      className={cls.join(" ")}
      onClick={action.onClick}
      title={action.title}
      aria-label={action.danger ? `${action.label} (destructive)` : undefined}
    >
      <span className="topbar__btn-label">
        {action.glyph ? `${action.glyph} ${action.label}` : action.label}
      </span>
      {action.kbd && <kbd>{action.kbd}</kbd>}
    </button>
  );
}

interface KebabProps {
  items: TopbarAction[];
  leading?: { node: ReactNode; menuLabel: string };
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}

function OverflowKebab({ items, leading, open, onToggle, onClose }: KebabProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);

  const totalCount = items.length + (leading ? 1 : 0);

  return (
    <div ref={wrapperRef} className="topbar-actions__kebab-wrap">
      <button
        type="button"
        className="topbar__btn topbar-actions__kebab"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`more actions (${totalCount})`}
      >
        <span className="topbar__btn-label">⋯</span>
      </button>
      {open && (
        <ul
          className="topbar-actions__menu"
          role="menu"
          aria-label="More actions"
        >
          {leading && (
            <li className="topbar-actions__menu-leading" role="presentation">
              <span className="topbar-actions__menu-leading-label">
                {leading.menuLabel}
              </span>
              {leading.node}
            </li>
          )}
          {items.map((it) => (
            <li
              key={it.id}
              role="menuitem"
              tabIndex={0}
              className={`topbar-actions__menu-item${it.danger ? " topbar-actions__menu-item--danger" : ""}`}
              onClick={() => {
                onClose();
                it.onClick();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onClose();
                  it.onClick();
                }
              }}
            >
              <span className="topbar-actions__menu-label">
                {it.glyph ? `${it.glyph} ${it.label}` : it.label}
              </span>
              {it.kbd && (
                <kbd className="topbar-actions__menu-kbd">{it.kbd}</kbd>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function setEquals<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
