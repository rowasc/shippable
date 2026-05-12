import mermaid from "mermaid";

// Shared, idempotent mermaid init. Two call sites (PlanDiagramView and the
// markdown ```mermaid block) need to agree on config; both must keep
// `securityLevel: "loose"` for `click` directives — strict mode silently
// strips them.
let inited = false;
export function ensureMermaidReady(): void {
  if (inited) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "neutral",
    securityLevel: "loose",
    flowchart: { htmlLabels: true, curve: "basis" },
  });
  inited = true;
}
