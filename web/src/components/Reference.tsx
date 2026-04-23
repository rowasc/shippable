import "./Reference.css";
import type { EvidenceRef } from "../types";

interface Props {
  ev: EvidenceRef;
  /**
   * When provided, navigable refs (file, hunk, symbol) render as buttons and
   * invoke this on click. Descriptions are never clickable — they have no
   * target in the diff.
   */
  onNavigate?: (ev: EvidenceRef) => void;
}

export function Reference({ ev, onNavigate }: Props) {
  const { label, title } = describeRef(ev);
  const navigable = ev.kind !== "description" && !!onNavigate;

  if (navigable) {
    return (
      <button
        type="button"
        className="ref ref--clickable"
        title={title}
        onClick={() => onNavigate!(ev)}
      >
        {label}
      </button>
    );
  }
  return (
    <span className="ref" title={title}>
      {label}
    </span>
  );
}

function describeRef(ev: EvidenceRef): { label: string; title: string } {
  switch (ev.kind) {
    case "description":
      return { label: "description", title: "from ChangeSet description" };
    case "file":
      return { label: ev.path, title: `open file ${ev.path}` };
    case "hunk": {
      // hunkId shape: "<csId>/<path>#hN" — keep the last slash segment so the
      // label fits in a chip.
      const short = ev.hunkId.split("/").slice(-1)[0];
      return { label: short, title: `jump to ${ev.hunkId}` };
    }
    case "symbol":
      return {
        label: ev.name,
        title: `jump to ${ev.name} (defined in ${ev.definedIn})`,
      };
  }
}
