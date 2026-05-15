import { useEffect } from "react";
import "./Toast.css";

interface Props {
  message: string;
  onClose: () => void;
  /** ms before auto-dismiss. Default 3s. */
  duration?: number;
}

/** Lightweight notification used for "already open — focused that window".
 *  Lives in-app — Wry blocks window.alert(), so a native toast is the
 *  only reliable surface. */
export function Toast({ message, onClose, duration = 3000 }: Props) {
  useEffect(() => {
    const t = window.setTimeout(onClose, duration);
    return () => window.clearTimeout(t);
  }, [message, duration, onClose]);

  return (
    <div className="toast" role="status" aria-live="polite">
      <span className="toast__msg">{message}</span>
      <button
        type="button"
        className="toast__x"
        aria-label="dismiss"
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}
