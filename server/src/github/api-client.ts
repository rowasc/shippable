/**
 * Thin wrapper around the GitHub REST API. Handles PAT injection, required
 * headers, pagination, and error normalization into a discriminated union so
 * callers can switch on `kind` rather than catching raw HTTP status codes.
 */

import { getDispatcher } from "../proxy.ts";

export type GithubError =
  | { kind: "github_token_required"; host: string }
  | {
      kind: "github_auth_failed";
      host: string;
      hint: "rate-limit" | "scope" | "invalid-token";
    }
  | { kind: "github_pr_not_found" }
  | { kind: "github_upstream"; status: number; message: string }
  /** Transport-layer failure: the request never produced an HTTP response
   *  (DNS, TCP, TLS, proxy connect, timeout). `detail` is best-effort and
   *  shaped for an inline error message — corp-proxy setups depend on it. */
  | { kind: "github_network"; host: string; detail: string };

export class GithubApiError extends Error {
  constructor(public readonly error: GithubError) {
    super(error.kind);
    this.name = "GithubApiError";
  }
}

const REQUIRED_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "shippable/0.1",
};

export interface FetchResult {
  status: number;
  headers: Headers;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}

/**
 * Best-effort one-liner for a thrown `fetch()` error. undici wraps the real
 * cause (DNS, TCP, TLS, proxy connect, timeout) as `err.cause` with a `code`
 * like `UND_ERR_CONNECT_TIMEOUT` / `ECONNREFUSED` / `ENOTFOUND`. We surface
 * both so a user staring at a corp-proxy outage sees something actionable.
 */
function describeFetchFailure(err: unknown): string {
  const cause =
    err && typeof err === "object" && "cause" in err
      ? (err as { cause: unknown }).cause
      : undefined;
  const causeRecord =
    cause && typeof cause === "object" ? (cause as Record<string, unknown>) : undefined;
  const code = typeof causeRecord?.code === "string" ? causeRecord.code : undefined;
  const causeMsg =
    typeof causeRecord?.message === "string" ? causeRecord.message : undefined;
  const topMsg = err instanceof Error ? err.message : String(err);
  if (code && causeMsg) return `${code}: ${causeMsg}`;
  return causeMsg ?? topMsg;
}

function throwNormalizedError(
  status: number,
  headers: Headers,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any,
  host: string,
): never {
  // 401 from GitHub means the token we sent was rejected. `githubFetch`
  // always supplies a token (callers must construct with a non-empty
  // value); the "no token at all" path is handled upstream in the route
  // handler before this is reached. Surface as `github_auth_failed` with
  // the `invalid-token` hint so the client opens the modal in the
  // rejection state — mapping this to `github_token_required` (its old
  // behavior) caused the Tauri cache-hit retry in useGithubPrLoad to
  // re-push the same rejected token and recurse indefinitely.
  if (status === 401) {
    throw new GithubApiError({
      kind: "github_auth_failed",
      host,
      hint: "invalid-token",
    });
  }
  if (status === 403) {
    const remaining = headers.get("X-RateLimit-Remaining");
    const hint =
      remaining === "0" ? "rate-limit" : "scope";
    throw new GithubApiError({ kind: "github_auth_failed", host, hint });
  }
  if (status === 404) {
    throw new GithubApiError({ kind: "github_pr_not_found" });
  }
  if (status >= 500) {
    const message =
      typeof body?.message === "string" ? body.message : `HTTP ${status}`;
    throw new GithubApiError({ kind: "github_upstream", status, message });
  }
  throw new GithubApiError({
    kind: "github_upstream",
    status,
    message: typeof body?.message === "string" ? body.message : `HTTP ${status}`,
  });
}

export async function githubFetch(
  apiBaseUrl: string,
  path: string,
  opts: {
    token: string;
    method?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body?: any;
    host?: string;
  },
): Promise<FetchResult> {
  const host = opts.host ?? new URL(apiBaseUrl).hostname;
  const url = `${apiBaseUrl.replace(/\/$/, "")}${path}`;
  // `dispatcher` is forwarded to undici under the hood for HTTPS_PROXY support.
  // Cast through `unknown` because node's RequestInit pulls `dispatcher` from
  // `undici-types`, which collides with the runtime `undici` package's types.
  const init = {
    method: opts.method ?? "GET",
    headers: {
      ...REQUIRED_HEADERS,
      Authorization: `Bearer ${opts.token}`,
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    dispatcher: getDispatcher(host),
  } as unknown as RequestInit;
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new GithubApiError({
      kind: "github_network",
      host,
      detail: describeFetchFailure(err),
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    throwNormalizedError(res.status, res.headers, json, host);
  }

  return { status: res.status, headers: res.headers, json };
}

/**
 * Fetch all pages of a paginated list endpoint, following `Link: rel="next"`
 * headers. Concatenates arrays across pages.
 */
export async function githubFetchAll<T>(
  apiBaseUrl: string,
  path: string,
  opts: { token: string; host?: string },
): Promise<T[]> {
  const results: T[] = [];
  // First page uses the path relative to apiBaseUrl; subsequent pages use the
  // absolute URL from the Link header, so we track a full URL for each iteration.
  let nextPath: string | null = path;
  let nextAbsolute: string | null = null;

  while (nextPath !== null || nextAbsolute !== null) {
    // githubFetch always prepends apiBaseUrl to the path. For subsequent pages
    // we have an absolute URL, so derive a relative path from it.
    const currentPath = nextAbsolute
      ? nextAbsolute.startsWith(apiBaseUrl.replace(/\/$/, ""))
        ? nextAbsolute.slice(apiBaseUrl.replace(/\/$/, "").length)
        : nextAbsolute
      : nextPath!;

    const { headers, json } = await githubFetch(apiBaseUrl, currentPath, opts);

    if (Array.isArray(json)) {
      results.push(...(json as T[]));
    }

    // Parse Link header for rel="next"
    const linkHeader = headers.get("Link") ?? "";
    const match = /<([^>]+)>;\s*rel="next"/.exec(linkHeader);
    nextPath = null;
    nextAbsolute = match ? match[1] : null;
  }

  return results;
}
