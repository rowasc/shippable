// E2E suite for the LSP-backed code graph. Runs against real intelephense
// or phpactor binaries — the stub-LSP unit suite covers wire-level wiring
// and our edge bucketing; this suite catches "the indexer changed its
// response shape" or "phpactor's references returns the empty set for
// trait method calls now."
//
// Never silently skipped. If no PHP LSP binary is reachable, beforeAll
// fails the suite with explicit install instructions. Run via
// `npm run test:e2e`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  resolveCodeGraph,
  invalidateCodeGraphForWorkspace,
  _resetCodeGraphCacheForTests,
} from "./codeGraph.ts";

const FIXTURE_DIR = path.resolve(__dirname, "../../test-fixtures/php-multifile");
const FIXTURE_FILES = ["Cart.php", "Order.php", "OrderRepository.php", "Loyalty.php", "PaymentGateway.php", "Routes.php"];

interface ServerCandidate {
  id: "intelephense" | "phpactor";
  binary: string;
  envPatch: { name: string; value: string };
}

const candidates: ServerCandidate[] = [];

function probeServers(): ServerCandidate[] {
  const out: ServerCandidate[] = [];
  const explicit = process.env.SHIPPABLE_PHP_LSP?.trim();
  if (explicit && fs.existsSync(explicit)) {
    const base = path.basename(explicit).toLowerCase();
    const id: ServerCandidate["id"] = base.startsWith("phpactor") ? "phpactor" : "intelephense";
    out.push({ id, binary: explicit, envPatch: { name: "SHIPPABLE_PHP_LSP", value: explicit } });
    return out;
  }
  for (const id of ["intelephense", "phpactor"] as const) {
    const found = whichBinary(id);
    if (found) out.push({ id, binary: found, envPatch: { name: "SHIPPABLE_PHP_LSP", value: found } });
  }
  return out;
}

function whichBinary(name: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return null;
}

function makeFixtureWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shippable-cg-e2e-"));
  execSync("git init -q", { cwd: root });
  for (const name of FIXTURE_FILES) {
    fs.copyFileSync(path.join(FIXTURE_DIR, name), path.join(root, name));
  }
  // Initial commit so `ref: HEAD` resolves cleanly when the endpoint or
  // intelephense look for one.
  execSync("git add -A && git -c user.email=t@t -c user.name=t commit -q -m fixture", { cwd: root });
  return root;
}

beforeAll(() => {
  const found = probeServers();
  if (found.length === 0) {
    throw new Error(
      [
        "e2e: no PHP LSP found.",
        "Install one (one of):",
        "  npm install -g intelephense",
        "  composer global require phpactor/phpactor",
        "Or set SHIPPABLE_PHP_LSP=/abs/path/to/intelephense-or-phpactor.",
        "To run only the unit/integration suite, use `npm run test`.",
      ].join("\n"),
    );
  }
  candidates.push(...found);
});

let workspaceRoot: string;
const ORIGINAL_PHP_LSP = process.env.SHIPPABLE_PHP_LSP;
const ORIGINAL_PATH = process.env.PATH;

beforeEach(() => {
  workspaceRoot = makeFixtureWorkspace();
  _resetCodeGraphCacheForTests();
});

afterEach(async () => {
  await invalidateCodeGraphForWorkspace(workspaceRoot);
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
  process.env.PATH = ORIGINAL_PATH;
  if (ORIGINAL_PHP_LSP === undefined) delete process.env.SHIPPABLE_PHP_LSP;
  else process.env.SHIPPABLE_PHP_LSP = ORIGINAL_PHP_LSP;
});

describe("code-graph E2E (real PHP LSP)", () => {
  // We register tests inside a function we call once probeServers has run.
  // beforeAll has already populated `candidates`; the for-of below runs
  // when describe is being collected — same vitest event loop tick — so
  // probe synchronously here as well to register a test per candidate.
  const detected = probeServers();
  if (detected.length === 0) {
    // Don't register tests yet; beforeAll will throw and the runner reports
    // the install instructions as the failure.
    it("should have at least one PHP LSP installed", () => {
      // beforeAll handles the message; this test never runs.
    });
    return;
  }

  for (const candidate of detected) {
    describe(`${candidate.id}`, () => {
      it("E1: returns LSP-resolved edges into Routes.php for the multi-file fixture", async () => {
        process.env.SHIPPABLE_PHP_LSP = candidate.binary;

        const files = FIXTURE_FILES.map((name) => ({
          path: name,
          text: fs.readFileSync(path.join(workspaceRoot, name), "utf8"),
        }));

        const result = await resolveCodeGraph({
          workspaceRoot,
          ref: "HEAD",
          scope: "diff",
          files,
        });

        expect(result.sources).toContainEqual({ language: "php", resolver: "lsp" });

        const intoRoutes = result.graph.edges.filter((edge) => edge.toPath === "Routes.php");
        const fromPaths = new Set(intoRoutes.map((edge) => edge.fromPath));
        // Different LSPs differ on labels and on whether they catch
        // every reference — but at minimum we expect Routes.php to be on
        // the receiving end of edges from at least three of the five
        // sibling classes. Pre-fix the regex builder produced zero such
        // edges (PHP `use` doesn't match the import regex).
        expect(fromPaths.size).toBeGreaterThanOrEqual(3);
        for (const from of fromPaths) {
          expect(FIXTURE_FILES).toContain(from);
        }
      }, 60_000);

      it("E2: surfaces edges from changed files into unchanged repo neighbours", async () => {
        process.env.SHIPPABLE_PHP_LSP = candidate.binary;

        // Pretend only Cart.php is part of the diff. Cart is referenced
        // by Order.php (via the constructor's `Cart $cart` parameter) and
        // by Routes.php — both unchanged neighbours that should now show
        // up as context nodes with edges from Cart.php.
        const changed = ["Cart.php"];
        const files = changed.map((name) => ({
          path: name,
          text: fs.readFileSync(path.join(workspaceRoot, name), "utf8"),
        }));

        const result = await resolveCodeGraph({
          workspaceRoot,
          ref: "HEAD",
          scope: "diff",
          files,
        });

        const nodesByPath = new Map(result.graph.nodes.map((n) => [n.path, n]));
        for (const name of changed) {
          expect(nodesByPath.get(name)?.role).toBe("changed");
        }

        // At least one unchanged sibling that uses Cart should have shown
        // up as a context node. Both intelephense and phpactor *should*
        // resolve at least one of these; we leave the exact set lenient
        // since indexer behaviour drifts.
        const expectedContextCandidates = ["Order.php", "Routes.php"];
        const contextNodes = result.graph.nodes.filter((n) => n.role === "context");
        expect(contextNodes.length).toBeGreaterThanOrEqual(1);
        for (const node of contextNodes) {
          expect(expectedContextCandidates).toContain(node.path);
        }

        // Every edge into a context node should originate from a changed
        // file — defining-file -> using-file is the invariant.
        const contextPaths = new Set(contextNodes.map((n) => n.path));
        const edgesIntoContext = result.graph.edges.filter((e) =>
          contextPaths.has(e.toPath),
        );
        expect(edgesIntoContext.length).toBeGreaterThanOrEqual(1);
        for (const edge of edgesIntoContext) {
          expect(changed).toContain(edge.fromPath);
        }
      }, 60_000);
    });
  }
});
