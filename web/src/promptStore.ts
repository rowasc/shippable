import { apiUrl } from "./apiUrl";
import type { ChangeSet, DiffFile, Hunk, LineSelection } from "./types";

export interface PromptArg {
  name: string;
  required: boolean;
  auto?: string;
  description?: string;
}

export interface Prompt {
  id: string;
  name: string;
  description: string;
  args: PromptArg[];
  body: string;
  source: "library" | "user";
}

const USER_KEY = "shippable.prompts.user";

export type PromptDraft = Omit<Prompt, "source">;

// In-process cache so we don't refetch the library on every picker open.
let libraryCache: Promise<Prompt[]> | null = null;

export async function listPrompts(): Promise<Prompt[]> {
  const [library, user] = await Promise.all([loadLibrary(), Promise.resolve(loadUser())]);
  // User prompts override library prompts with the same id.
  const byId = new Map<string, Prompt>();
  for (const p of library) byId.set(p.id, p);
  for (const p of user) byId.set(p.id, p);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function refreshLibrary(): void {
  libraryCache = null;
}

async function loadLibrary(): Promise<Prompt[]> {
  if (libraryCache) return libraryCache;
  libraryCache = (async () => {
    const res = await fetch(await apiUrl("/api/library/prompts"));
    if (!res.ok) {
      throw new Error(`failed to load library prompts (${res.status})`);
    }
    const body = (await res.json()) as { prompts: Omit<Prompt, "source">[] };
    return body.prompts.map((p) => ({ ...p, source: "library" as const }));
  })().catch((err) => {
    libraryCache = null;
    throw err;
  });
  return libraryCache;
}

function loadUser(): Prompt[] {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidPrompt).map((p) => ({ ...p, source: "user" as const }));
  } catch {
    return [];
  }
}

function persistUser(list: PromptDraft[]): void {
  localStorage.setItem(USER_KEY, JSON.stringify(list));
}

export function saveUserPrompt(draft: PromptDraft): Prompt {
  validateDraft(draft);
  const stored = loadUser().map(stripSource);
  const existingIdx = stored.findIndex((p) => p.id === draft.id);
  if (existingIdx >= 0) {
    stored[existingIdx] = draft;
  } else {
    stored.push(draft);
  }
  persistUser(stored);
  return { ...draft, source: "user" };
}

export function deleteUserPrompt(id: string): void {
  const stored = loadUser().map(stripSource).filter((p) => p.id !== id);
  persistUser(stored);
}

export function slugifyId(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "prompt";
}

function validateDraft(p: PromptDraft): void {
  if (!p.id.trim()) throw new Error("id is required");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(p.id)) {
    throw new Error("id must be lowercase letters, numbers, and dashes");
  }
  if (!p.name.trim()) throw new Error("name is required");
  if (!p.description.trim()) throw new Error("description is required");
  if (!p.body.trim()) throw new Error("body is required");
  const seen = new Set<string>();
  for (const a of p.args) {
    if (!a.name.trim()) throw new Error("arg name is required");
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(a.name)) {
      throw new Error(`arg name "${a.name}" must be a valid identifier`);
    }
    if (seen.has(a.name)) throw new Error(`duplicate arg name "${a.name}"`);
    seen.add(a.name);
  }
}

function stripSource({ id, name, description, args, body }: Prompt): PromptDraft {
  return { id, name, description, args, body };
}

function isValidPrompt(p: unknown): p is Omit<Prompt, "source"> {
  if (!p || typeof p !== "object") return false;
  const obj = p as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.name === "string" &&
    typeof obj.description === "string" &&
    typeof obj.body === "string" &&
    Array.isArray(obj.args)
  );
}

// ── rendering ─────────────────────────────────────────────────────────────
// Mustache-ish: {{name}} substitutes; {{#name}}...{{/name}} only renders the
// inner block if the value is non-empty. Inverted blocks not supported in v1.
export function renderTemplate(
  body: string,
  args: Record<string, string | undefined>,
): string {
  let result = body.replace(
    /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_, name: string, inner: string) => {
      const val = args[name];
      return val && val.trim().length > 0 ? inner : "";
    },
  );
  result = result.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    return args[name] ?? "";
  });
  return result;
}

// ── auto-fill context ─────────────────────────────────────────────────────
// Resolve context from the current cursor / selection. The picker reads each
// arg's `auto:` hint and pre-fills from this context.

export interface AutoFillContext {
  changeset: { title: string; diff: string };
  file: { path: string };
  selection: string;
}

export function buildAutoFillContext(
  cs: ChangeSet,
  file: DiffFile,
  hunk: Hunk,
  selection: LineSelection | null,
): AutoFillContext {
  return {
    changeset: { title: cs.title, diff: changesetToDiff(cs) },
    file: { path: file.path },
    selection: hunkToDiff(file, hunk, selection),
  };
}

export function resolveAuto(
  hint: string | undefined,
  ctx: AutoFillContext,
): string | undefined {
  if (!hint) return undefined;
  switch (hint) {
    case "selection":
      return ctx.selection;
    case "file":
      return ctx.file.path;
    case "changeset.title":
      return ctx.changeset.title;
    case "changeset.diff":
      return ctx.changeset.diff;
    default:
      return undefined;
  }
}

// ── diff serialization ────────────────────────────────────────────────────

function changesetToDiff(cs: ChangeSet): string {
  const parts: string[] = [];
  for (const file of cs.files) {
    parts.push(`diff --git a/${file.path} b/${file.path}`);
    if (file.status === "added") parts.push("new file mode 100644");
    if (file.status === "deleted") parts.push("deleted file mode 100644");
    parts.push(file.status === "added" ? "--- /dev/null" : `--- a/${file.path}`);
    parts.push(file.status === "deleted" ? "+++ /dev/null" : `+++ b/${file.path}`);
    for (const h of file.hunks) {
      parts.push(`@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@`);
      for (const l of h.lines) {
        parts.push(`${linePrefix(l.kind)}${l.text}`);
      }
    }
  }
  return parts.join("\n");
}

function hunkToDiff(
  file: DiffFile,
  hunk: Hunk,
  selection: LineSelection | null,
): string {
  let lines = hunk.lines;
  let header = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;
  if (selection && selection.hunkId === hunk.id) {
    const a = Math.min(selection.anchor, selection.head);
    const b = Math.max(selection.anchor, selection.head);
    lines = hunk.lines.slice(a, b + 1);
    header += ` (lines ${a + 1}–${b + 1})`;
  }
  const parts: string[] = [];
  parts.push(`File: ${file.path}`);
  parts.push(header);
  for (const l of lines) {
    parts.push(`${linePrefix(l.kind)}${l.text}`);
  }
  return parts.join("\n");
}

function linePrefix(kind: "context" | "add" | "del"): string {
  return kind === "add" ? "+" : kind === "del" ? "-" : " ";
}
