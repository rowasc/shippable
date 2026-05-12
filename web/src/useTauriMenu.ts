// Bridge between the Rust-side app menu (src-tauri/src/menu.rs) and the
// React app. Listens for `shippable:menu` events and dispatches them to
// the right place — find-bar visibility for "find", webview zoom for the
// zoom items. Zoom level is persisted to localStorage and restored on mount.
//
// Web (non-Tauri) gets the browser's native Cmd+F and Cmd+± — this hook
// becomes a no-op there.

import { useCallback, useEffect, useState } from "react";
import { isTauri } from "./keychain";

const ZOOM_KEY = "shippable.zoom";
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;

type MenuAction = "find" | "zoom-in" | "zoom-out" | "zoom-reset";

function readStoredZoom(): number {
  const raw = localStorage.getItem(ZOOM_KEY);
  if (!raw) return 1;
  const n = Number(raw);
  return Number.isFinite(n) && n >= ZOOM_MIN && n <= ZOOM_MAX ? n : 1;
}

function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
}

async function applyZoom(level: number): Promise<void> {
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  await getCurrentWebview().setZoom(level);
}

export function useTauriMenu(): { findOpen: boolean; closeFind: () => void } {
  const [findOpen, setFindOpen] = useState(false);
  const closeFind = useCallback(() => setFindOpen(false), []);

  // Restore zoom on mount.
  useEffect(() => {
    if (!isTauri()) return;
    const z = readStoredZoom();
    if (z !== 1) {
      applyZoom(z).catch((err) => console.warn("[shippable] restore zoom:", err));
    }
  }, []);

  // Menu event subscription.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const off = await listen<MenuAction>("shippable:menu", (e) => {
        const action = e.payload;
        if (action === "find") {
          setFindOpen(true);
          return;
        }
        const current = readStoredZoom();
        let next = current;
        if (action === "zoom-in") next = clampZoom(current + ZOOM_STEP);
        else if (action === "zoom-out") next = clampZoom(current - ZOOM_STEP);
        else if (action === "zoom-reset") next = 1;
        if (next === current) return;
        localStorage.setItem(ZOOM_KEY, String(next));
        applyZoom(next).catch((err) =>
          console.warn("[shippable] setZoom:", err),
        );
      });
      if (cancelled) off();
      else unlisten = off;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return { findOpen, closeFind };
}
