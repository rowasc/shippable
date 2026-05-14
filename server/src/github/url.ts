export interface PrCoords {
  host: string;
  owner: string;
  repo: string;
  number: number;
  apiBaseUrl: string;
  htmlUrl: string;
}

export function resolveApiBase(host: string): string {
  // Test-only override: the e2e suite points this at a local fake upstream so
  // PR ingest exercises the real browser→server→upstream path without hitting
  // github.com. Unset in every shipped configuration.
  const override = process.env.SHIPPABLE_GITHUB_API_BASE;
  if (override) return override;
  return host === "github.com"
    ? "https://api.github.com"
    : `https://${host}/api/v3`;
}

export function parsePrUrl(input: string): PrCoords {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`invalid PR URL: not parseable as a URL`);
  }

  if (url.protocol !== "https:") {
    throw new Error(
      `invalid PR URL: scheme must be https (got "${url.protocol}")`,
    );
  }

  if (url.port) {
    throw new Error(`invalid PR URL: port not allowed (got :${url.port})`);
  }

  const host = url.hostname;

  const parts = url.pathname.split("/");
  const owner = parts[1] ?? "";
  const repo = parts[2] ?? "";
  const pullSegment = parts[3] ?? "";
  const nStr = parts[4] ?? "";

  if (!owner) throw new Error(`invalid PR URL: missing owner segment`);
  if (!repo) throw new Error(`invalid PR URL: missing repo segment`);
  if (pullSegment !== "pull") {
    throw new Error(
      `invalid PR URL: expected /pull/<n>, got /${pullSegment}/<n>`,
    );
  }

  const number = Number(nStr);
  if (!nStr || !Number.isInteger(number) || number < 1) {
    throw new Error(
      `invalid PR URL: PR number must be a positive integer (got "${nStr}")`,
    );
  }

  const apiBaseUrl = resolveApiBase(host);
  const htmlUrl = `https://${host}/${owner}/${repo}/pull/${number}`;

  return { host, owner, repo, number, apiBaseUrl, htmlUrl };
}
