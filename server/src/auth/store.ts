// Generic in-memory credential store keyed by the flat string form from
// `credential.ts`. Replaces the GH-only `server/src/github/auth-store.ts`.
//
// Values never leak from `listCredentials` — only the discriminator does.
// The github host blocklist is preserved verbatim from the old store and is
// applied at the write boundary on the github branch only.

import { encodeStoreKey, decodeStoreKey, type Credential } from "./credential.ts";

const store = new Map<string, string>();

const BLOCKED = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  // IPv4 unspecified — kernels will resolve this to localhost on connect.
  /^0\.0\.0\.0$/,
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
  // IPv4-mapped IPv6 — `::ffff:127.0.0.1` reaches the same loopback as the
  // bare IPv4 form would, so the kernel-level translation lets a caller
  // bypass the IPv4 blocklist by typing the address with the prefix.
  /^::ffff:/i,
];

function assertGithubHostAllowed(host: string): void {
  const h = host.trim().toLowerCase();
  if (BLOCKED.some((re) => re.test(h))) {
    // Don't echo the host: handleAuthSet catches this and returns the bare
    // "host_blocked" discriminator, but a future logger could surface the
    // Error.message verbatim. Defense in depth — the caller already knows
    // which host they sent in.
    throw new Error("auth-store: github host is not allowed");
  }
}

export function setCredential(credential: Credential, value: string): void {
  if (credential.kind === "github") {
    assertGithubHostAllowed(credential.host);
  }
  store.set(encodeStoreKey(credential), value);
}

export function hasCredential(credential: Credential): boolean {
  return store.has(encodeStoreKey(credential));
}

export function getCredential(credential: Credential): string | undefined {
  return store.get(encodeStoreKey(credential));
}

export function clearCredential(credential: Credential): void {
  store.delete(encodeStoreKey(credential));
}

export function listCredentials(): Credential[] {
  // Sort by raw store key for deterministic ordering: `anthropic` precedes
  // `github:*`, and github hosts are alphabetical.
  return [...store.keys()].sort().map(decodeStoreKey);
}

/** Test-only: reset all stored credentials. */
export function resetForTests(): void {
  store.clear();
}
