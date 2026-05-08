import { useEffect, useId, useMemo, useRef, useState } from "react";
import mermaid from "mermaid";
import "./PlanDiagramView.css";
import type { PlanDiagram, PlanDiagramNode } from "../planDiagram";
import type { EvidenceRef } from "../types";
import { CopyButton } from "./CopyButton";

interface Props {
  diagram: PlanDiagram;
  includeMarkdown: boolean;
  onToggleMarkdown: () => void;
  /** Wire-through to ReviewPlanView's evidence-navigation handler.
   *  Receives an `EvidenceRef` of `kind: "file"` so clicking a node
   *  scrolls the diff to that file. */
  onNavigate?: (ev: EvidenceRef) => void;
}

// Initialise mermaid once per session. `securityLevel: "loose"` is what
// enables `click <id> callback "tooltip"` to invoke a registered window
// handler — strict mode strips the click directive entirely.
let mermaidInited = false;
function ensureMermaidReady(): void {
  if (mermaidInited) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "neutral",
    securityLevel: "loose",
    flowchart: { htmlLabels: true, curve: "basis" },
  });
  mermaidInited = true;
}

const MERMAID_CALLBACK_PROP = "__shippableDiagramClick";

declare global {
  interface Window {
    [MERMAID_CALLBACK_PROP]?: (path: string) => void;
  }
}

export function PlanDiagramView({
  diagram,
  includeMarkdown,
  onToggleMarkdown,
  onNavigate,
}: Props) {
  const renderId = useId().replace(/[:]/g, "_");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  const enrichedSource = useMemo(
    () => withClickDirectives(diagram),
    [diagram],
  );

  useEffect(() => {
    ensureMermaidReady();
    // Mermaid invokes the global named in `click f0 callback "..."`. We
    // register a single dispatcher keyed on path; the diagram embeds
    // `click <id> __shippableDiagramClick "<path>"` per node.
    window[MERMAID_CALLBACK_PROP] = (path: string) => {
      onNavigate?.({ kind: "file", path });
    };
    return () => {
      delete window[MERMAID_CALLBACK_PROP];
    };
  }, [onNavigate]);

  useEffect(() => {
    let cancelled = false;
    const target = containerRef.current;
    if (!target) return;
    setRenderError(null);
    mermaid
      .render(`mermaid-${renderId}`, enrichedSource)
      .then((result) => {
        if (cancelled || !target) return;
        target.innerHTML = result.svg;
        if (result.bindFunctions) {
          result.bindFunctions(target);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setRenderError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [enrichedSource, renderId]);

  const hasMarkdown = diagram.markdownCount > 0;
  const markdownToggle = hasMarkdown ? (
    <button
      type="button"
      className="plan-diagram__toggle"
      onClick={onToggleMarkdown}
      aria-pressed={includeMarkdown}
      title={
        includeMarkdown
          ? "Hide markdown files from the diagram"
          : `Include ${diagram.markdownCount} markdown file${diagram.markdownCount === 1 ? "" : "s"} in the diagram`
      }
    >
      {includeMarkdown ? "hide docs" : "show docs"}
    </button>
  ) : null;

  if (diagram.nodes.length === 0) {
    return (
      <section className="plan-diagram">
        <DiagramTabs />
        <div className="plan-diagram__head">
          <div>
            <div className="plan-diagram__title">Map</div>
            <div className="plan-diagram__hint">
              {hasMarkdown && !includeMarkdown
                ? "Only markdown files in this change — toggle to include them."
                : "No files in this change."}
            </div>
          </div>
          {markdownToggle}
        </div>
      </section>
    );
  }

  const disagreements = diagram.nodes.filter(
    (node) => node.pathRole !== node.fileRole,
  );

  return (
    <section className="plan-diagram">
      <DiagramTabs />
      <div className="plan-diagram__head">
        <div>
          <div className="plan-diagram__title">Map</div>
          <div className="plan-diagram__hint">
            {diagram.scope === "repo"
              ? "Generated from the current worktree checkout. Changed files stay highlighted; unchanged repo neighbors give the wider map."
              : diagram.nodes.some((node) => node.role === "context")
                ? "Generated from the current diff. Dimmed nodes are unchanged repo files the diff reaches into."
                : "Generated from the current diff. Click a node to jump to that file in the diff."}
          </div>
        </div>
        <div className="plan-diagram__head-actions">
          {markdownToggle}
          <CopyButton text={diagram.mermaid} title="Copy Mermaid diagram source" />
        </div>
      </div>

      <div className="plan-diagram__canvas">
        {renderError ? (
          <div className="plan-diagram__error">
            <p>Couldn't render the diagram:</p>
            <pre>{renderError}</pre>
          </div>
        ) : null}
        <div
          ref={containerRef}
          className="plan-diagram__mermaid"
          aria-label="Code map for the current changeset"
        />
      </div>

      {disagreements.length > 0 ? (
        <DisagreementLegend nodes={disagreements} />
      ) : null}

      <details className="plan-diagram__source">
        <summary>Mermaid source</summary>
        <pre className="plan-diagram__code">
          <code>{enrichedSource}</code>
        </pre>
      </details>
    </section>
  );
}

function DiagramTabs() {
  // Static placeholders — see docs/plans/diagram-typed-file-graph.md.
  return (
    <div className="plan-diagram__tabs" role="tablist" aria-label="Diagram types">
      <button
        type="button"
        role="tab"
        aria-selected="true"
        className="plan-diagram__tab plan-diagram__tab--active"
      >
        Map
      </button>
      <button
        type="button"
        role="tab"
        aria-disabled="true"
        disabled
        className="plan-diagram__tab"
        title="Class diagram needs symbol-level capture (methods, fields per class)."
      >
        Class
      </button>
      <button
        type="button"
        role="tab"
        aria-disabled="true"
        disabled
        className="plan-diagram__tab"
        title="State diagram needs control-flow extraction we don't capture today."
      >
        State
      </button>
      <button
        type="button"
        role="tab"
        aria-disabled="true"
        disabled
        className="plan-diagram__tab"
        title="Sequence diagram needs call-trace data we don't capture today."
      >
        Sequence
      </button>
      <button
        type="button"
        role="tab"
        aria-disabled="true"
        disabled
        className="plan-diagram__tab"
        title="ER diagram needs schema parsing we don't capture today."
      >
        ER
      </button>
    </div>
  );
}

function DisagreementLegend({ nodes }: { nodes: PlanDiagramNode[] }) {
  return (
    <aside className="plan-diagram__legend" aria-label="Classifier disagreements">
      <div className="plan-diagram__legend-title">
        LSP-shape upgraded the role on {nodes.length} file
        {nodes.length === 1 ? "" : "s"}
      </div>
      <ul>
        {nodes.map((node) => (
          <li key={node.id}>
            <code>{node.path}</code> — classified as{" "}
            <strong>{node.fileRole}</strong> (path looked like{" "}
            <em>{node.pathRole}</em>)
          </li>
        ))}
      </ul>
    </aside>
  );
}

function withClickDirectives(diagram: PlanDiagram): string {
  // The diagram source already encodes nodes + classes + edges. We append
  // one `click <id> <callback> "<path>"` per node so mermaid wires up DOM
  // handlers when it renders. The callback name resolves against `window`.
  const lines = diagram.nodes.map(
    (node) => `  click ${node.id} ${MERMAID_CALLBACK_PROP} "${escapeQuotes(node.path)}"`,
  );
  return `${diagram.mermaid}\n${lines.join("\n")}`;
}

function escapeQuotes(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}
