import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LANGUAGES,
  languageForFile,
  languageForRequestId,
  lspLanguageIdFor,
} from "./languages/index.ts";
import type { LanguageModule } from "./languages/index.ts";
import {
  getLspClient,
  unavailableReason,
  type LspLocation,
  type LspLocationLink,
} from "./lspClient.ts";
import type {
  DefinitionCapabilities,
  DefinitionLanguageCapability,
  DefinitionLocation,
  DefinitionRequest,
  DefinitionResponse,
} from "../../web/src/definitionTypes.ts";

interface ResolvedDefinitionRequest {
  file: string;
  module: LanguageModule;
  line: number;
  col: number;
  workspaceRoot: string;
  filePath: string;
}

export function getDefinitionCapabilities(): DefinitionCapabilities {
  const languages = LANGUAGES.map(toLanguageCapability);
  return {
    languages,
    requiresWorktree: true,
    anyAvailable: languages.some((l) => l.available),
  };
}

function toLanguageCapability(module: LanguageModule): DefinitionLanguageCapability {
  const discovered = module.discover();
  if (!discovered) {
    return {
      id: module.id,
      languageIds: [...module.languageIds],
      available: false,
      resolver: null,
      source: null,
      reason: unavailableReason(module),
      recommendedSetup: module.recommendedSetup.map((r) => ({ ...r })),
    };
  }
  return {
    id: module.id,
    languageIds: [...module.languageIds],
    available: true,
    resolver: path.basename(discovered.command),
    source: discovered.source,
    recommendedSetup: module.recommendedSetup.map((r) => ({ ...r })),
  };
}

export async function resolveDefinition(
  request: DefinitionRequest,
): Promise<DefinitionResponse> {
  let resolved: ResolvedDefinitionRequest;
  try {
    resolved = await resolveRequest(request);
  } catch (err) {
    return {
      status: "unsupported",
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  const discovered = resolved.module.discover();
  if (!discovered) {
    return {
      status: "unsupported",
      reason: unavailableReason(resolved.module),
    };
  }

  try {
    const client = await getLspClient(resolved.workspaceRoot, resolved.module);
    const source = await fsp.readFile(resolved.filePath, "utf8");
    const lspLanguageId = lspLanguageIdFor(resolved.module, resolved.filePath);
    const rawLocations = await client.definition(resolved.filePath, lspLanguageId, source, {
      line: resolved.line,
      col: resolved.col,
    });
    const definitions = await Promise.all(
      rawLocations.map((location) =>
        normalizeLocation(location, resolved.workspaceRoot, path.basename(discovered.command)),
      ),
    );
    return { status: "ok", definitions };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function resolveRequest(
  request: DefinitionRequest,
): Promise<ResolvedDefinitionRequest> {
  if (typeof request.file !== "string" || request.file.trim() === "") {
    throw new Error("definition request missing file path");
  }
  if (!Number.isInteger(request.line) || request.line < 0) {
    throw new Error(`definition request line must be a non-negative integer, got ${request.line}`);
  }
  if (!Number.isInteger(request.col) || request.col < 0) {
    throw new Error(`definition request col must be a non-negative integer, got ${request.col}`);
  }

  const module = pickLanguageModule(request);
  const workspaceRoot = await resolveWorkspaceRoot(request.workspaceRoot);
  const filePath = path.resolve(workspaceRoot, request.file);
  assertInsideRoot(filePath, workspaceRoot);
  const stat = await fsp.stat(filePath).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error(`file not found in workspace root: ${request.file}`);
  }

  return {
    file: request.file,
    module,
    line: request.line,
    col: request.col,
    workspaceRoot,
    filePath,
  };
}

function pickLanguageModule(request: DefinitionRequest): LanguageModule {
  if (typeof request.language === "string" && request.language.trim() !== "") {
    const byId = languageForRequestId(request.language);
    if (byId) return byId;
  }
  const byExt = languageForFile(request.file);
  if (byExt) return byExt;

  const supported = LANGUAGES
    .map((m) => `${m.id} (${m.languageIds.join("/")})`)
    .join(", ");
  throw new Error(
    `definition lookup doesn't support language=${request.language ?? "<unset>"} for ${request.file}. Supported: ${supported}.`,
  );
}

async function resolveWorkspaceRoot(candidate: string | null | undefined): Promise<string> {
  const raw = typeof candidate === "string" && candidate.trim() !== ""
    ? candidate.trim()
    : process.env.SHIPPABLE_WORKSPACE_ROOT?.trim();
  if (!raw) {
    throw new Error("definition lookup needs a worktree-backed changeset or SHIPPABLE_WORKSPACE_ROOT");
  }
  if (!path.isAbsolute(raw)) {
    throw new Error(`workspace root must be an absolute path, got: ${raw}`);
  }
  if (raw.split(path.sep).includes("..")) {
    throw new Error("workspace root must not contain '..' segments");
  }
  const stat = await fsp.stat(raw).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`workspace root does not exist: ${raw}`);
  }
  const gitEntry = await fsp.stat(path.join(raw, ".git")).catch(() => null);
  if (!gitEntry) {
    throw new Error(`workspace root is not a git checkout: ${raw}`);
  }
  return raw;
}

function assertInsideRoot(filePath: string, root: string): void {
  const relative = path.relative(root, filePath);
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    return;
  }
  throw new Error(`requested file escapes workspace root: ${filePath}`);
}

async function normalizeLocation(
  location: LspLocation | LspLocationLink,
  workspaceRoot: string,
  resolverLabel: string,
): Promise<DefinitionLocation> {
  const uri = "targetUri" in location ? location.targetUri : location.uri;
  const range = "targetUri" in location ? location.targetSelectionRange : location.range;
  const absolutePath = fileURLToPath(uri);
  const workspaceRelativePath = toWorkspaceRelativePath(absolutePath, workspaceRoot);
  const displayPath = workspaceRelativePath ?? absolutePath;
  const preview = await readPreview(absolutePath, range.start.line);
  return {
    uri,
    file: displayPath,
    workspaceRelativePath,
    line: range.start.line,
    col: range.start.character,
    endLine: range.end.line,
    endCol: range.end.character,
    preview,
    resolver: resolverLabel,
  };
}

function toWorkspaceRelativePath(
  absolutePath: string,
  workspaceRoot: string,
): string | null {
  const relative = path.relative(workspaceRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative;
}

async function readPreview(filePath: string, line: number): Promise<string> {
  try {
    const text = await fsp.readFile(filePath, "utf8");
    const lines = text.split(/\r?\n/);
    const start = Math.max(0, line - 2);
    const end = Math.min(lines.length, line + 3);
    return lines
      .slice(start, end)
      .map((entry, idx) => `${start + idx + 1}: ${entry}`)
      .join("\n");
  } catch {
    return "";
  }
}
