import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./LoadModal.css";

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// Replacement for window.confirm — Tauri's Wry webview does not implement a JS
// confirm panel handler, so window.confirm() returns falsy without showing UI.
export function ConfirmModal({
  title,
  message,
  confirmLabel,
  cancelLabel = "cancel",
  danger,
  onConfirm,
  onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const content = (
    <div className="modal" onClick={onCancel}>
      <div className="modal__box" onClick={(e) => e.stopPropagation()}>
        <header className="modal__h">
          <span className="modal__h-label">{title}</span>
          <button className="modal__close" onClick={onCancel}>
            × close
          </button>
        </header>
        <section className="modal__sec">
          <p className="modal__hint">{message}</p>
          <div className="modal__row modal__row--end">
            <button className="modal__btn" onClick={onCancel}>
              {cancelLabel}
            </button>
            <button
              ref={confirmRef}
              className={
                danger
                  ? "modal__btn modal__btn--danger"
                  : "modal__btn modal__btn--primary"
              }
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
        </section>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
