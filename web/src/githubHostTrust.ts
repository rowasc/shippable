const STORAGE_KEY = "shippable:githubTrustedHosts:v1";

function normalizeHost(host: string): string {
  return host.trim().toLowerCase();
}

export function isGithubDotCom(host: string): boolean {
  return normalizeHost(host) === "github.com";
}

export function githubApiBaseForHost(host: string): string {
  const normalized = normalizeHost(host);
  return normalized === "github.com"
    ? "https://api.github.com"
    : `https://${normalized}/api/v3`;
}

export function readTrustedGithubHosts(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is string => typeof entry === "string",
    );
  } catch {
    return [];
  }
}

export function isGithubHostTrusted(host: string): boolean {
  const normalized = normalizeHost(host);
  if (!normalized) return false;
  if (normalized === "github.com") return true;

  return readTrustedGithubHosts().includes(normalized);
}

export function trustGithubHost(host: string): void {
  const normalized = normalizeHost(host);
  if (!normalized || normalized === "github.com") return;

  try {
    const hosts = readTrustedGithubHosts();
    if (!hosts.includes(normalized)) hosts.push(normalized);
    hosts.sort();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(hosts));
  } catch {
    // Host trust is a UX guard, not a durable auth boundary.
  }
}
