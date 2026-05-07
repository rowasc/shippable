import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertGitDir } from "../worktree-validation.ts";
import { GIT } from "../worktrees.ts";
import { githubFetch } from "./api-client.ts";
import { resolveApiBase } from "./url.ts";

const execFileAsync = promisify(execFile);

export interface PrMatch {
  host: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  htmlUrl: string;
}

export type LookupResult =
  | { kind: "ok"; matched: PrMatch | null }
  | { kind: "token_required"; host: string };

interface ParsedRemote {
  host: string;
  owner: string;
  repo: string;
}

const HTTPS_RE = /^https?:\/\/([^/]+)\/([^/]+)\/([^/.]+?)(?:\.git)?(?:\/.*)?$/;
const SSH_RE = /^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/;

function parseRemoteUrl(url: string): ParsedRemote | null {
  let m = HTTPS_RE.exec(url);
  if (m) {
    const hostWithUserinfo = m[1];
    // Strip "user:pass@" if present — credentials don't belong in the auth-store key.
    const host = hostWithUserinfo.includes("@")
      ? hostWithUserinfo.slice(hostWithUserinfo.lastIndexOf("@") + 1)
      : hostWithUserinfo;
    return { host, owner: m[2], repo: m[3] };
  }
  m = SSH_RE.exec(url);
  if (m) return { host: m[1], owner: m[2], repo: m[3] };
  return null;
}

/**
 * Look up the open PR for the branch currently checked out in `worktreePath`.
 *
 * Multiple GitHub remotes: we use the first one found in `git remote -v`
 * output (typically `origin`). This matches the most common case and is
 * consistent with how the fetch-from-upstream tooling behaves.
 */
export async function lookupPrForBranch(
  worktreePath: string,
  getToken: (host: string) => string | undefined,
): Promise<LookupResult> {
  await assertGitDir(worktreePath);

  // Get remote URLs
  let remoteOut: string;
  try {
    const { stdout } = await execFileAsync(
      GIT,
      ["remote", "-v"],
      { cwd: worktreePath, maxBuffer: 256 * 1024 },
    );
    remoteOut = stdout;
  } catch {
    return { kind: "ok", matched: null };
  }

  // Parse first usable GitHub-shaped remote (deduplicated by unique host/owner/repo)
  let remote: ParsedRemote | null = null;
  for (const line of remoteOut.split("\n")) {
    // Each line: "<name>\t<url> (<type>)"
    const tabIdx = line.indexOf("\t");
    if (tabIdx < 0) continue;
    const rest = line.slice(tabIdx + 1);
    const spaceIdx = rest.lastIndexOf(" ");
    const url = spaceIdx >= 0 ? rest.slice(0, spaceIdx) : rest;
    const parsed = parseRemoteUrl(url.trim());
    if (parsed) {
      remote = parsed;
      break;
    }
  }

  if (!remote) return { kind: "ok", matched: null };

  // Get current branch
  let branch: string;
  try {
    const { stdout } = await execFileAsync(
      GIT,
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: worktreePath },
    );
    const trimmed = stdout.trim();
    if (!trimmed || trimmed === "HEAD") return { kind: "ok", matched: null };
    branch = trimmed;
  } catch {
    return { kind: "ok", matched: null };
  }

  // Resolve token
  const token = getToken(remote.host);
  if (!token) {
    return { kind: "token_required", host: remote.host };
  }

  // Query GitHub for open PRs from this branch
  const base = resolveApiBase(remote.host);
  const path = `/repos/${remote.owner}/${remote.repo}/pulls?head=${remote.owner}:${branch}&state=open&per_page=1`;
  try {
    const { json } = await githubFetch(base, path, {
      token,
      host: remote.host,
    });

    if (!Array.isArray(json) || json.length === 0) {
      return { kind: "ok", matched: null };
    }

    const pr = json[0];
    const rawState: string = pr.state ?? "open";
    const state: PrMatch["state"] =
      rawState === "closed" && pr.merged ? "merged" : (rawState as "open" | "closed");

    return {
      kind: "ok",
      matched: {
        host: remote.host,
        owner: remote.owner,
        repo: remote.repo,
        number: pr.number,
        title: pr.title,
        state,
        htmlUrl: pr.html_url,
      },
    };
  } catch {
    return { kind: "ok", matched: null };
  }
}
