import { parseDiff } from "../../../web/src/parseDiff.ts";
import type {
  ChangeSet,
  DiffLine,
  PrConversationItem,
  PrReviewComment,
  PrSource,
} from "../../../web/src/types.ts";
import { githubFetch, githubFetchAll } from "./api-client.ts";
import type { PrCoords } from "./url.ts";

interface GhPrMeta {
  title: string;
  body: string | null;
  state: "open" | "closed";
  merged: boolean;
  html_url: string;
  head: { sha: string; ref: string };
  base: { sha: string; ref: string };
  user: { login: string };
  changed_files: number;
}

interface GhPrFile {
  filename: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  patch?: string;
  previous_filename?: string;
}

interface GhLineComment {
  id: number;
  user: { login: string };
  body: string;
  path: string;
  /** The line in the file at the end of the comment range. */
  line: number;
  /** Original line (pre-rebase). We use `line` for matching. */
  original_line: number;
  /** First line of a multi-line comment; null for single-line. */
  start_line: number | null;
  created_at: string;
  html_url: string;
  side: "LEFT" | "RIGHT";
}

interface GhIssueComment {
  id: number;
  user: { login: string };
  body: string;
  created_at: string;
  html_url: string;
}

function fileHeaders(f: GhPrFile): string {
  if (f.status === "added") {
    return `--- /dev/null\n+++ b/${f.filename}\n`;
  }
  if (f.status === "removed") {
    return `--- a/${f.filename}\n+++ /dev/null\n`;
  }
  if (f.status === "renamed") {
    const oldName = f.previous_filename ?? f.filename;
    return `rename from ${oldName}\nrename to ${f.filename}\n--- a/${oldName}\n+++ b/${f.filename}\n`;
  }
  return `--- a/${f.filename}\n+++ b/${f.filename}\n`;
}

function assembleDiffText(files: GhPrFile[]): string {
  return files
    .filter((f) => f.patch)
    .map((f) => {
      const oldName = f.status === "renamed" ? (f.previous_filename ?? f.filename) : f.filename;
      return `diff --git a/${oldName} b/${f.filename}\n${fileHeaders(f)}${f.patch}`;
    })
    .join("\n");
}

/** Build a lookup: path → (lineNo → DiffLine) for fast comment matching. */
function buildLineIndex(
  cs: ChangeSet,
): Map<string, Map<number, DiffLine>> {
  const index = new Map<string, Map<number, DiffLine>>();
  for (const file of cs.files) {
    const lineMap = new Map<number, DiffLine>();
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        // For add/context lines, match on newNo; for del lines, match on oldNo.
        const no = line.newNo ?? line.oldNo;
        if (no !== undefined) {
          lineMap.set(no, line);
        }
      }
    }
    index.set(file.path, lineMap);
  }
  return index;
}

export async function loadPr(
  coords: PrCoords,
  token: string,
): Promise<ChangeSet> {
  const { host, owner, repo, number, apiBaseUrl } = coords;
  const opts = { token, host };
  const repoBase = `/repos/${owner}/${repo}`;

  // Fan out four parallel GitHub requests.
  const [meta, files, lineComments, issueComments] = await Promise.all([
    githubFetch(apiBaseUrl, `${repoBase}/pulls/${number}`, opts).then(
      (r) => r.json as GhPrMeta,
    ),
    githubFetchAll<GhPrFile>(
      apiBaseUrl,
      `${repoBase}/pulls/${number}/files?per_page=100`,
      opts,
    ),
    githubFetchAll<GhLineComment>(
      apiBaseUrl,
      `${repoBase}/pulls/${number}/comments?per_page=100`,
      opts,
    ),
    githubFetchAll<GhIssueComment>(
      apiBaseUrl,
      `${repoBase}/issues/${number}/comments?per_page=100`,
      opts,
    ),
  ]);

  const id = `pr:${host}:${owner}:${repo}:${number}`;
  const state: PrSource["state"] =
    meta.state === "closed" && meta.merged ? "merged" : meta.state;

  const diffText = assembleDiffText(files);

  const cs = parseDiff(diffText, {
    id,
    title: meta.title,
    author: meta.user.login,
    base: meta.base.sha,
    head: meta.head.sha,
  });

  const prSource: PrSource = {
    host,
    owner,
    repo,
    number,
    htmlUrl: meta.html_url,
    headSha: meta.head.sha,
    baseSha: meta.base.sha,
    state,
    title: meta.title,
    body: meta.body ?? "",
    baseRef: meta.base.ref,
    headRef: meta.head.ref,
    lastFetchedAt: new Date().toISOString(),
  };

  // Detect GitHub-level truncation: compare the files we fetched against the
  // authoritative changed_files count from the PR metadata. If they differ,
  // GitHub truncated the file listing before we could paginate all of them.
  if (files.length < meta.changed_files) {
    prSource.truncation = {
      kind: "files",
      reason: `Fetched ${files.length} of ${meta.changed_files} files; GitHub limits the file-list response.`,
    };
  }

  // Walk line comments and attach to matching DiffLines.
  const lineIndex = buildLineIndex(cs);

  // LEFT-side comments anchored on context lines may be silently dropped:
  // our index keys by newNo for context lines, while LEFT-side comments
  // reference the base-side line number. Acceptable as best-effort for v0.
  for (const comment of lineComments) {
    const lineMap = lineIndex.get(comment.path);
    if (!lineMap) continue; // file not in diff

    const targetLine = comment.line;
    const diffLine = lineMap.get(targetLine);
    if (!diffLine) continue; // line not in diff — silently drop

    const prComment: PrReviewComment = {
      id: comment.id,
      author: comment.user.login,
      createdAt: comment.created_at,
      body: comment.body,
      htmlUrl: comment.html_url,
    };

    if (comment.start_line !== null && comment.start_line !== comment.line) {
      prComment.lineSpan = { lo: comment.start_line, hi: comment.line };
    }

    if (!diffLine.prReviewComments) {
      diffLine.prReviewComments = [];
    }
    diffLine.prReviewComments.push(prComment);
  }

  const prConversation: PrConversationItem[] = issueComments.map((c) => ({
    id: c.id,
    author: c.user.login,
    createdAt: c.created_at,
    body: c.body,
    htmlUrl: c.html_url,
  }));

  return {
    ...cs,
    prSource,
    prConversation,
  };
}

