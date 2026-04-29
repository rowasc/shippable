import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const BUNDLED_LIBRARY = path.join(REPO_ROOT, "library");
const VAR_DIR = path.join(REPO_ROOT, "server", "var", "library");
const CHECKOUT_DIR = path.join(VAR_DIR, "checkout");
const SOURCE_FILE = path.join(VAR_DIR, "source.json");

export type LibrarySource =
  | { kind: "bundled"; root: string }
  | { kind: "path"; root: string }
  | { kind: "git"; root: string; url: string; ref: string };

let cached: LibrarySource | null = null;
let inflight: Promise<LibrarySource> | null = null;

export async function root(): Promise<string> {
  return (await resolve()).root;
}

export async function source(): Promise<LibrarySource> {
  return resolve();
}

export async function currentRef(): Promise<string | null> {
  const s = await resolve();
  if (s.kind !== "git") return null;
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: CHECKOUT_DIR,
  });
  return stdout.trim();
}

// Force a fresh resolution. For git sources this re-fetches and re-checks-out
// the configured ref so a moving `main` is picked up without restarting the
// server.
export async function sync(): Promise<LibrarySource> {
  cached = null;
  return resolve();
}

async function resolve(): Promise<LibrarySource> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    const url = process.env.SHIPPABLE_LIBRARY_REPO_URL?.trim();
    const ref = process.env.SHIPPABLE_LIBRARY_REPO_REF?.trim() || "main";
    const localPath = process.env.SHIPPABLE_LIBRARY_PATH?.trim();
    const subpath = process.env.SHIPPABLE_LIBRARY_SUBPATH?.trim() || "";

    let s: LibrarySource;
    if (url) {
      const checkoutRoot = await ensureGitCheckout(url, ref);
      s = {
        kind: "git",
        root: subpath ? path.join(checkoutRoot, subpath) : checkoutRoot,
        url,
        ref,
      };
    } else if (localPath) {
      const resolved = path.resolve(localPath);
      s = {
        kind: "path",
        root: subpath ? path.join(resolved, subpath) : resolved,
      };
    } else {
      s = {
        kind: "bundled",
        root: subpath ? path.join(BUNDLED_LIBRARY, subpath) : BUNDLED_LIBRARY,
      };
    }

    try {
      const stat = await fs.stat(s.root);
      if (!stat.isDirectory()) {
        throw new Error(`library root is not a directory: ${s.root}`);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`library root not accessible (${s.kind}: ${s.root}): ${reason}`);
    }

    cached = s;
    return s;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

async function ensureGitCheckout(url: string, ref: string): Promise<string> {
  await fs.mkdir(VAR_DIR, { recursive: true });

  const previous = await readSourceFile();
  const hasCheckout = await exists(CHECKOUT_DIR);
  const sameUrl = previous?.url === url;

  if (!hasCheckout || !sameUrl) {
    if (hasCheckout) {
      await fs.rm(CHECKOUT_DIR, { recursive: true, force: true });
    }
    await execFileAsync("git", ["clone", "--quiet", url, CHECKOUT_DIR]);
  }

  await execFileAsync("git", ["fetch", "--quiet", "origin"], {
    cwd: CHECKOUT_DIR,
  });
  // Detach first so `reset --hard` doesn't try to move a local branch.
  await execFileAsync("git", ["checkout", "--quiet", "--detach"], {
    cwd: CHECKOUT_DIR,
  });
  // Try as a remote branch; fall back to ref-as-tag-or-sha.
  try {
    await execFileAsync("git", ["reset", "--quiet", "--hard", `origin/${ref}`], {
      cwd: CHECKOUT_DIR,
    });
  } catch {
    await execFileAsync("git", ["reset", "--quiet", "--hard", ref], {
      cwd: CHECKOUT_DIR,
    });
  }

  await writeSourceFile({ url, ref });
  return CHECKOUT_DIR;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readSourceFile(): Promise<{ url: string; ref: string } | null> {
  try {
    const raw = await fs.readFile(SOURCE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.url === "string" && typeof parsed.ref === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

async function writeSourceFile(data: { url: string; ref: string }): Promise<void> {
  await fs.writeFile(SOURCE_FILE, JSON.stringify(data, null, 2), "utf8");
}
