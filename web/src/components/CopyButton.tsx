import { useEffect, useRef, useState } from "react";
import "./CopyButton.css";

interface Props {
  /** Text written to the clipboard when the user clicks. */
  text: string;
  /** Optional extra class — useful for per-host positioning tweaks. */
  className?: string;
  /** Accessible hover label; defaults to a generic clipboard action. */
  title?: string;
}

type State = "idle" | "ok" | "fail";

export function CopyButton({ text, className, title = "Copy to clipboard" }: Props) {
  const [state, setState] = useState<State>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setState("ok");
    } catch {
      setState("fail");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1500);
  };

  const label = state === "ok" ? "copied" : state === "fail" ? "copy failed" : "copy";
  return (
    <button
      type="button"
      className={`copybtn copybtn--${state}${className ? ` ${className}` : ""}`}
      onClick={copy}
      title={title}
    >
      {label}
    </button>
  );
}
