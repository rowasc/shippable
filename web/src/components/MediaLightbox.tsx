import { useCallback, useEffect, useRef, useState } from "react";
import "./MediaLightbox.css";

export type LightboxContent =
  | { kind: "svg"; svg: string }
  | { kind: "image"; src: string; alt?: string };

interface Props {
  content: LightboxContent;
  onClose: () => void;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 12;

// Fullscreen overlay that lets the user wheel-zoom (centered on the cursor)
// and drag-pan a Mermaid diagram or markdown image. Markdown content lives
// in a narrow column; non-trivial diagrams and full-resolution screenshots
// are unreadable there. Tauri's webview also ignores `target="_blank"`, so
// "open in a new tab" isn't a portable escape hatch.
export function MediaLightbox({ content, onClose }: Props) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);

  // For SVG content we inject the markup directly and strip intrinsic sizing
  // so the diagram fills the stage; for images we render an <img> below.
  useEffect(() => {
    if (content.kind !== "svg") return;
    const el = contentRef.current;
    if (!el) return;
    el.innerHTML = content.svg;
    const svgEl = el.querySelector("svg");
    if (!svgEl) return;
    svgEl.removeAttribute("width");
    svgEl.removeAttribute("height");
    const style = (svgEl as SVGElement).style;
    style.width = "100%";
    style.height = "100%";
    style.maxWidth = "none";
    style.maxHeight = "none";
  }, [content]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    setTransform((prev) => {
      const factor = Math.exp(-e.deltaY * 0.0015);
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * factor));
      // Pin the point under the cursor to its content-space position.
      const ratio = nextScale / prev.scale;
      return {
        x: cx - (cx - prev.x) * ratio,
        y: cy - (cy - prev.y) * ratio,
        scale: nextScale,
      };
    });
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        baseX: transform.x,
        baseY: transform.y,
      };
    },
    [transform.x, transform.y],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setTransform((prev) => ({
      ...prev,
      x: drag.baseX + (e.clientX - drag.startX),
      y: drag.baseY + (e.clientY - drag.startY),
    }));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    dragRef.current = null;
  }, []);

  const reset = useCallback(() => setTransform({ x: 0, y: 0, scale: 1 }), []);

  return (
    <div
      className="media-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={content.kind === "svg" ? "Diagram viewer" : (content.alt ?? "Image viewer")}
    >
      <div className="media-lightbox__toolbar">
        <span className="media-lightbox__hint">scroll to zoom · drag to pan · esc to close</span>
        <button type="button" className="media-lightbox__btn" onClick={reset}>
          reset
        </button>
        <button
          type="button"
          className="media-lightbox__btn"
          onClick={onClose}
          aria-label="close"
        >
          × close
        </button>
      </div>
      <div
        ref={stageRef}
        className="media-lightbox__stage"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          ref={contentRef}
          className="media-lightbox__content"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
        >
          {content.kind === "image" ? (
            <img
              src={content.src}
              alt={content.alt ?? ""}
              className="media-lightbox__img"
              draggable={false}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
