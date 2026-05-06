import fsp from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  LANGUAGES,
  languageForFile,
  languageForRequestId,
  lspLanguageIdFor,
} from "./languages/index.ts";
import type { LanguageModule } from "./languages/index.ts";
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

interface LspLocation {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

interface LspLocationLink {
  targetUri: string;
  targetSelectionRange: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

// Cache LSP clients per (workspace, language). The TS server and the PHP
// server are different long-running subprocesses; we don't want to spawn
// either eagerly, and we don't want to share one across languages.
const clientCache = new Map<string, Map<string, Promise<LspClient>>>();

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

function unavailableReason(module: LanguageModule): string {
  const setup = module.recommendedSetup
    .map((r) => `  - ${r.label}: ${r.command}`)
    .join("\n");
  return `No ${module.id.toUpperCase()} language server discovered. Try one of:\n${setup}`;
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
    const client = await getClient(resolved.workspaceRoot, resolved.module);
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

async function getClient(
  workspaceRoot: string,
  module: LanguageModule,
): Promise<LspClient> {
  let perWorkspace = clientCache.get(workspaceRoot);
  if (!perWorkspace) {
    perWorkspace = new Map();
    clientCache.set(workspaceRoot, perWorkspace);
  }
  let cached = perWorkspace.get(module.id);
  if (!cached) {
    cached = LspClient.create(module, workspaceRoot);
    perWorkspace.set(module.id, cached);
  }
  try {
    return await cached;
  } catch (err) {
    perWorkspace.delete(module.id);
    if (perWorkspace.size === 0) clientCache.delete(workspaceRoot);
    throw err;
  }
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

class LspClient {
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly openedDocuments = new Set<string>();
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private closed = false;
  private initialized: Promise<void>;

  static create(module: LanguageModule, workspaceRoot: string): Promise<LspClient> {
    const discovered = module.discover();
    if (!discovered) {
      return Promise.reject(new Error(unavailableReason(module)));
    }
    const client = new LspClient(discovered.command, discovered.args, workspaceRoot, module.id);
    return client.initialized.then(() => client);
  }

  private constructor(
    command: string,
    args: readonly string[],
    private readonly workspaceRoot: string,
    private readonly languageLabel: string,
  ) {
    this.proc = spawn(command, [...args], {
      cwd: workspaceRoot,
      stdio: "pipe",
    });
    this.proc.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    this.proc.stderr.on("data", () => undefined);
    this.proc.on("error", (err) => this.failAll(err instanceof Error ? err : new Error(String(err))));
    this.proc.on("exit", (code, signal) => {
      this.failAll(
        new Error(`${this.languageLabel} language server exited (code=${code ?? "null"}, signal=${signal ?? "null"})`),
      );
    });
    this.initialized = this.initialize();
  }

  async definition(
    filePath: string,
    lspLanguageId: string,
    source: string,
    position: { line: number; col: number },
  ): Promise<Array<LspLocation | LspLocationLink>> {
    await this.initialized;
    await this.openDocument(filePath, lspLanguageId, source);
    const result = await this.request("textDocument/definition", {
      textDocument: { uri: pathToFileURL(filePath).href },
      position: { line: position.line, character: position.col },
    });
    return normalizeDefinitionResult(result);
  }

  private async initialize(): Promise<void> {
    await this.request("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(this.workspaceRoot).href,
      capabilities: {},
      workspaceFolders: [
        {
          uri: pathToFileURL(this.workspaceRoot).href,
          name: path.basename(this.workspaceRoot),
        },
      ],
    });
    this.notify("initialized", {});
  }

  private async openDocument(
    filePath: string,
    lspLanguageId: string,
    source: string,
  ): Promise<void> {
    const uri = pathToFileURL(filePath).href;
    if (this.openedDocuments.has(uri)) return;
    this.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: lspLanguageId,
        version: 1,
        text: source,
      },
    });
    this.openedDocuments.add(uri);
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error(`LSP client already closed before ${method}`));
    }
    const id = this.nextId++;
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write(payload);
    });
  }

  private notify(method: string, params: unknown): void {
    if (this.closed) return;
    this.write({
      jsonrpc: "2.0",
      method,
      params,
    });
  }

  private write(payload: unknown): void {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
    this.proc.stdin.write(Buffer.concat([header, body]));
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.buffer.slice(0, headerEnd).toString("utf8");
      const contentLength = parseContentLength(header);
      if (contentLength == null) {
        this.failAll(new Error(`invalid LSP header: ${header}`));
        return;
      }
      const totalLength = headerEnd + 4 + contentLength;
      if (this.buffer.length < totalLength) return;
      const body = this.buffer.slice(headerEnd + 4, totalLength).toString("utf8");
      this.buffer = this.buffer.slice(totalLength);
      this.onMessage(body);
    }
  }

  private onMessage(body: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      this.failAll(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    const message = parsed as { id?: number; result?: unknown; error?: { message?: string } };
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message ?? "LSP request failed"));
      return;
    }
    pending.resolve(message.result);
  }

  private failAll(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function parseContentLength(header: string): number | null {
  const line = header
    .split("\r\n")
    .find((entry) => entry.toLowerCase().startsWith("content-length:"));
  if (!line) return null;
  const raw = line.slice("content-length:".length).trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDefinitionResult(result: unknown): Array<LspLocation | LspLocationLink> {
  if (!result) return [];
  if (Array.isArray(result)) {
    return result.filter(isLocationLike);
  }
  return isLocationLike(result) ? [result] : [];
}

function isLocationLike(value: unknown): value is LspLocation | LspLocationLink {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    (typeof record.uri === "string" && isRange(record.range)) ||
    (typeof record.targetUri === "string" && isRange(record.targetSelectionRange))
  );
}

function isRange(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const range = value as Record<string, unknown>;
  return isPosition(range.start) && isPosition(range.end);
}

function isPosition(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const position = value as Record<string, unknown>;
  return (
    typeof position.line === "number" &&
    typeof position.character === "number"
  );
}
