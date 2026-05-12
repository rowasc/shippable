// Portal-mounted modal that hosts the settings-mode CredentialsPanel. Closes
// on backdrop click and Esc. Reuses LoadModal's modal CSS for the frame.

import { useEffect } from "react";
import { createPortal } from "react-dom";
import "./LoadModal.css";
import { CredentialsPanel } from "./CredentialsPanel";

interface Props {
  onClose: () => void;
}

export function SettingsModal({ onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const content = (
    <div
      className="modal"
      data-testid="settings-backdrop"
      onClick={onClose}
    >
      <div
        className="modal__box"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="settings"
      >
        <header className="modal__h">
          <span className="modal__h-label">settings</span>
          <button className="modal__close" onClick={onClose}>
            × close
          </button>
        </header>
        <section className="modal__sec">
          <CredentialsPanel mode="settings" />
        </section>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
