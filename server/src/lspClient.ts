import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { pathToFileURL } from "node:url";
import type { LanguageModule } from "./languages/index.ts";

// LSP protocol shapes we touch. Servers vary on hierarchical
// (DocumentSymbol, with `children`) vs flat (SymbolInformation, with
// `location`); we accept both and normalise above this layer.
export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

export interface LspLocationLink {
  targetUri: string;
  targetSelectionRange: LspRange;
}

export interface LspDocumentSymbol {
  name: string;
  kind: number;
  range: LspRange;
  selectionRange: LspRange;
  detail?: string;
  children?: LspDocumentSymbol[];
}

export interface LspSymbolInformation {
  name: string;
  kind: number;
  location: LspLocation;
  containerName?: string;
}

const clientCache = new Map<string, Map<string, Promise<LspClient>>>();

/**
 * Acquire the LSP client for a given (workspace, language). Cached per
 * process — the same client is shared between definition lookups and
 * code-graph queries. On failure the cache slot is dropped so callers can
 * retry without restarting the server.
 */
export async function getLspClient(
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

/**
 * Drop every LSP client for a workspace. Used by code-graph cache
 * invalidation; the next request lazily respawns. Each child is asked to
 * shut down politely first, then killed if it lingers.
 */
export async function disposeLspClientsForWorkspace(
  workspaceRoot: string,
): Promise<void> {
  const perWorkspace = clientCache.get(workspaceRoot);
  if (!perWorkspace) return;
  clientCache.delete(workspaceRoot);
  await Promise.all(
    Array.from(perWorkspace.values()).map(async (entry) => {
      try {
        const client = await entry;
        await client.dispose();
      } catch {
        // already errored — nothing to do
      }
    }),
  );
}

export function unavailableReason(module: LanguageModule): string {
  const setup = module.recommendedSetup
    .map((r) => `  - ${r.label}: ${r.command}`)
    .join("\n");
  return `No ${module.id.toUpperCase()} language server discovered. Try one of:\n${setup}`;
}

interface ServerCapabilities {
  documentSymbolProvider?: boolean | { workDoneProgress?: boolean };
  referencesProvider?: boolean | { workDoneProgress?: boolean };
  definitionProvider?: boolean | { workDoneProgress?: boolean };
}

export class LspClient {
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly openedDocuments = new Set<string>();
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private closed = false;
  private capabilities: ServerCapabilities = {};
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

  /** Reports server-advertised capabilities — null until `initialize` resolves. */
  capability(name: keyof ServerCapabilities): boolean {
    const value = this.capabilities[name];
    if (value === undefined) return false;
    if (typeof value === "boolean") return value;
    return true;
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
    return normalizeLocations(result);
  }

  async documentSymbol(
    filePath: string,
    lspLanguageId: string,
    source: string,
  ): Promise<Array<LspDocumentSymbol | LspSymbolInformation>> {
    await this.initialized;
    await this.openDocument(filePath, lspLanguageId, source);
    const result = await this.request("textDocument/documentSymbol", {
      textDocument: { uri: pathToFileURL(filePath).href },
    });
    if (!Array.isArray(result)) return [];
    return result.filter(isSymbolLike);
  }

  async references(
    filePath: string,
    lspLanguageId: string,
    source: string,
    position: { line: number; col: number },
    options: { includeDeclaration?: boolean } = {},
  ): Promise<LspLocation[]> {
    await this.initialized;
    await this.openDocument(filePath, lspLanguageId, source);
    const includeDeclaration = options.includeDeclaration ?? false;
    const result = await this.request("textDocument/references", {
      textDocument: { uri: pathToFileURL(filePath).href },
      position: { line: position.line, character: position.col },
      context: { includeDeclaration },
    });
    if (!Array.isArray(result)) return [];
    const locations = result.filter(isPlainLocation);
    if (includeDeclaration) return locations;
    // Some servers ignore `includeDeclaration: false`. Filter the trivial
    // self-reference client-side too — match the URI + start position.
    const declUri = pathToFileURL(filePath).href;
    return locations.filter(
      (loc) =>
        !(loc.uri === declUri &&
          loc.range.start.line === position.line &&
          loc.range.start.character === position.col),
    );
  }

  /**
   * Hint the server that we're done with a file. Best-effort — protocol
   * lets us send didClose any time after didOpen.
   */
  closeDocument(filePath: string): void {
    const uri = pathToFileURL(filePath).href;
    if (!this.openedDocuments.delete(uri)) return;
    this.notify("textDocument/didClose", { textDocument: { uri } });
  }

  async dispose(): Promise<void> {
    if (this.closed) return;
    try {
      await this.request("shutdown", null).catch(() => undefined);
      this.notify("exit", null);
    } finally {
      this.closed = true;
      try {
        this.proc.kill();
      } catch {
        // already dead
      }
    }
  }

  private async initialize(): Promise<void> {
    const result = await this.request("initialize", {
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
    if (result && typeof result === "object" && "capabilities" in result) {
      const caps = (result as { capabilities?: unknown }).capabilities;
      if (caps && typeof caps === "object") this.capabilities = caps as ServerCapabilities;
    }
    this.notify("initialized", {});
  }

  private async openDocument(
    filePath: string,
    lspLanguageId: string,
    source: string,
  ): Promise<void> {
    const uri = pathToFileURL(filePath).href;
    if (this.openedDocuments.has(uri)) return;
    // The check-and-set is synchronous: `notify` writes immediately and
    // doesn't await. Two concurrent callers see the second one short-circuit
    // on the next microtask after the first set the flag. If this method
    // ever grows an `await` between the check and the set, switch to a
    // per-uri Promise map.
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

export function normalizeLocations(result: unknown): Array<LspLocation | LspLocationLink> {
  if (!result) return [];
  if (Array.isArray(result)) return result.filter(isLocationLike);
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

function isPlainLocation(value: unknown): value is LspLocation {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.uri === "string" && isRange(record.range);
}

function isSymbolLike(value: unknown): value is LspDocumentSymbol | LspSymbolInformation {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string" || typeof record.kind !== "number") return false;
  if (isRange(record.range) && isRange(record.selectionRange)) return true;
  if (record.location && typeof record.location === "object" && isPlainLocation(record.location)) return true;
  return false;
}

function isRange(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const range = value as Record<string, unknown>;
  return isPosition(range.start) && isPosition(range.end);
}

function isPosition(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const position = value as Record<string, unknown>;
  return typeof position.line === "number" && typeof position.character === "number";
}
