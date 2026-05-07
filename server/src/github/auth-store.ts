const store = new Map<string, string>();

const BLOCKED = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^::1$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  // RFC1918 172.16.0.0/12 — second octet 16–31
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  // IPv4 link-local (169.254.0.0/16) — includes cloud IMDS endpoints
  /^169\.254\.\d+\.\d+$/,
  // CGNAT (100.64.0.0/10) — second octet 64–127
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/,
  // IPv6 link-local (fe80::/10)
  /^fe80:/i,
  // IPv6 ULA (fc00::/7 — fc and fd prefixes)
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
];

function normalize(host: string): string {
  return host.toLowerCase();
}

// The block-list is enforced on `setToken` only — the write side is the
// boundary. Read-side calls (`hasToken`, `getToken`, `clearToken`) on a
// blocked host are silent no-ops because the host can never have been
// stored in the first place.
function assertNotBlocked(host: string): void {
  const h = normalize(host);
  if (BLOCKED.some((re) => re.test(h))) {
    throw new Error(`github auth-store: host "${host}" is not allowed`);
  }
}

export function setToken(host: string, token: string): void {
  assertNotBlocked(host);
  store.set(normalize(host), token);
}

export function hasToken(host: string): boolean {
  return store.has(normalize(host));
}

export function getToken(host: string): string | undefined {
  return store.get(normalize(host));
}

export function clearToken(host: string): void {
  store.delete(normalize(host));
}

/** Test-only: reset all stored tokens. */
export function resetForTests(): void {
  store.clear();
}
