/**
 * Thin wrapper around the GitHub REST API. Handles PAT injection, required
 * headers, pagination, and error normalization into a discriminated union so
 * callers can switch on `kind` rather than catching raw HTTP status codes.
 */

export type GithubError =
  | { kind: "github_token_required"; host: string }
  | { kind: "github_auth_failed"; host: string; hint: "rate-limit" | "scope" }
  | { kind: "github_pr_not_found" }
  | { kind: "github_upstream"; status: number; message: string };

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

function throwNormalizedError(
  status: number,
  headers: Headers,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any,
  host: string,
): never {
  if (status === 401) {
    throw new GithubApiError({ kind: "github_token_required", host });
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
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      ...REQUIRED_HEADERS,
      Authorization: `Bearer ${opts.token}`,
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });

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
