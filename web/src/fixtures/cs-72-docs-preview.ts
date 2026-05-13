import type { ChangeSet, DiffLine, Interaction } from "../types";
import { hunkSummaryReplyKey } from "../types";

// Exercises the markdown preview mode — every diff in this changeset is a
// .md file, including a fresh page that uses tables, GFM alerts, task lists,
// fenced code, and a relative image reference. The image is provided inline
// as a data URL so the preview can resolve `./assets/preview-screenshot.svg`
// without any network access.

const PREVIEW_DOC_LINES = `# Markdown Preview

A quick tour of what the new preview pane handles. The same source is what
ships to GitHub when this lands on the main branch.

## What renders

| Feature       | Status        | Notes                              |
| ------------- | ------------- | ---------------------------------- |
| GFM tables    | ✅ supported  | including alignment                |
| Task lists    | ✅ supported  | unchecked + checked                |
| Alerts        | ✅ supported  | NOTE / TIP / WARNING / CAUTION     |
| Code blocks   | ✅ Shiki      | reuses the diff highlighter        |
| Mermaid       | ⏭️ later      | tracked in the v0.2 milestone      |

## Reviewer checklist

- [x] Tables align as expected
- [x] Code blocks pick up syntax highlighting
- [ ] Alerts get the right border color in Dollhouse Noir

## Example

\`\`\`ts
function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
\`\`\`

> [!NOTE]
> Relative images are resolved against the file's directory and looked up
> in the changeset's \`imageAssets\` map.

![Preview screenshot](./assets/preview-screenshot.svg)

> [!WARNING]
> Links to other markdown files don't navigate yet — they render with the
> resolved repo path in a tooltip.
`.split("\n");

const README_OLD = [
  "# shippable",
  "",
  "Early prototype of an AI-assisted code review tool.",
  "",
  "## Running it",
  "",
  "See `web/README.md` for the dev server.",
  "",
];

const README_NEW = [
  "# shippable",
  "",
  "Early prototype of an AI-assisted code review tool.",
  "",
  "## Running it",
  "",
  "See `web/README.md` for the dev server.",
  "",
  "## Preview mode",
  "",
  "Markdown files in a diff can now be viewed as rendered preview — see",
  "[the preview docs](./docs/preview-demo.md) for what it handles.",
  "",
];

function fullForAdded(lines: string[]): DiffLine[] {
  return lines.map((text, i) => ({ kind: "add", text, newNo: i + 1 }));
}

function fullForReadme(): DiffLine[] {
  // Pre-existing context lines unchanged; one block of additions at the end.
  const out: DiffLine[] = README_OLD.map((text, i) => ({
    kind: "context",
    text,
    oldNo: i + 1,
    newNo: i + 1,
  }));
  for (let i = README_OLD.length; i < README_NEW.length; i++) {
    out.push({ kind: "add", text: README_NEW[i], newNo: i + 1 });
  }
  return out;
}

const PREVIEW_SCREENSHOT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180">
  <rect width="320" height="180" fill="#0d1117"/>
  <rect x="0" y="0" width="320" height="28" fill="#161b22"/>
  <circle cx="14" cy="14" r="5" fill="#ff5f57"/>
  <circle cx="32" cy="14" r="5" fill="#febc2e"/>
  <circle cx="50" cy="14" r="5" fill="#28c840"/>
  <text x="80" y="18" font-family="ui-monospace, monospace" font-size="11" fill="#c9d1d9">docs/preview-demo.md · Preview</text>
  <rect x="20" y="48" width="180" height="14" rx="3" fill="#238636"/>
  <text x="28" y="59" font-family="ui-monospace, monospace" font-size="10" fill="#ffffff">## What renders</text>
  <rect x="20" y="72" width="280" height="8" rx="2" fill="#21262d"/>
  <rect x="20" y="86" width="240" height="8" rx="2" fill="#21262d"/>
  <rect x="20" y="100" width="260" height="8" rx="2" fill="#21262d"/>
  <rect x="20" y="120" width="280" height="40" rx="4" fill="#161b22" stroke="#30363d"/>
  <text x="28" y="140" font-family="ui-monospace, monospace" font-size="11" fill="#7ee787">function clamp(value, min, max) {</text>
  <text x="44" y="154" font-family="ui-monospace, monospace" font-size="11" fill="#79c0ff">return Math.min(Math.max(value, min), max);</text>
</svg>`;

const PREVIEW_SCREENSHOT_DATA_URL =
  "data:image/svg+xml;utf8," + encodeURIComponent(PREVIEW_SCREENSHOT_SVG);

export const CS_72: ChangeSet = {
  id: "cs-72",
  title: "Document the markdown preview mode",
  author: "ines",
  branch: "docs/preview-mode",
  base: "main",
  createdAt: "2026-04-30T16:00:00Z",
  description:
    "Adds a `docs/preview-demo.md` page showing the GFM features the new preview pane handles, plus a short note in the README pointing readers to it.",
  files: [
    {
      id: "cs-72/docs/preview-demo.md",
      path: "docs/preview-demo.md",
      language: "markdown",
      status: "added",
      hunks: [
        {
          id: "cs-72/docs/preview-demo.md#h1",
          header: `@@ -0,0 +1,${PREVIEW_DOC_LINES.length} @@`,
          oldStart: 0,
          oldCount: 0,
          newStart: 1,
          newCount: PREVIEW_DOC_LINES.length,
          aiReviewed: true,
          lines: PREVIEW_DOC_LINES.map((text, i) => ({
            kind: "add",
            text,
            newNo: i + 1,
          })),
        },
      ],
      fullContent: fullForAdded(PREVIEW_DOC_LINES),
    },
    {
      id: "cs-72/README.md",
      path: "README.md",
      language: "markdown",
      status: "modified",
      hunks: [
        {
          id: "cs-72/README.md#h1",
          header: `@@ -7,1 +7,7 @@`,
          oldStart: 7,
          oldCount: 1,
          newStart: 7,
          newCount: 7,
          lines: [
            { kind: "context", text: "See `web/README.md` for the dev server.", oldNo: 7, newNo: 7 },
            { kind: "context", text: "", oldNo: 8, newNo: 8 },
            { kind: "add", text: "## Preview mode", newNo: 9 },
            { kind: "add", text: "", newNo: 10 },
            { kind: "add", text: "Markdown files in a diff can now be viewed as rendered preview — see", newNo: 11 },
            { kind: "add", text: "[the preview docs](./docs/preview-demo.md) for what it handles.", newNo: 12 },
            { kind: "add", text: "", newNo: 13 },
          ],
        },
      ],
      fullContent: fullForReadme(),
    },
  ],
  imageAssets: {
    "docs/assets/preview-screenshot.svg": PREVIEW_SCREENSHOT_DATA_URL,
  },
};

const PREVIEW_H1 = "cs-72/docs/preview-demo.md#h1";

export const INTERACTIONS_72: Record<string, Interaction[]> = {
  [hunkSummaryReplyKey(PREVIEW_H1)]: [
    {
      id: `ai:${hunkSummaryReplyKey(PREVIEW_H1)}`,
      threadKey: hunkSummaryReplyKey(PREVIEW_H1),
      target: "block",
      intent: "comment",
      author: "ai",
      authorRole: "ai",
      body:
        "New documentation page; reviewer should switch to Preview to confirm tables, alerts, code, and the screenshot all render before signing off.",
      createdAt: "0001-01-01T00:00:00.000Z",
    },
  ],
};

