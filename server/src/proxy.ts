/**
 * HTTPS proxy support for outbound fetches. Node's built-in undici fetch does
 * not honor HTTPS_PROXY env vars by default; corporate egress and GHE setups
 * need an explicit ProxyAgent passed as the `dispatcher` option.
 *
 * Memoized: the ProxyAgent is a long-lived connection pool, build once.
 */

import { ProxyAgent, type Dispatcher } from "undici";

let cached: { agent: Dispatcher | undefined } | null = null;
let warned = false;

function readProxyUrl(): string | undefined {
  const raw = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? "";
  return raw.trim() || undefined;
}

function buildAgent(): Dispatcher | undefined {
  const url = readProxyUrl();
  if (!url) return undefined;
  try {
    new URL(url);
  } catch {
    if (!warned) {
      console.warn(`[server] HTTPS_PROXY is set but malformed (${url}); ignoring`);
      warned = true;
    }
    return undefined;
  }
  return new ProxyAgent(url);
}

function noProxyMatches(hostname: string): boolean {
  const raw = process.env.NO_PROXY ?? process.env.no_proxy ?? "";
  if (!raw.trim()) return false;
  const host = hostname.toLowerCase();
  for (const entryRaw of raw.split(",")) {
    const entry = entryRaw.trim().toLowerCase();
    if (!entry) continue;
    if (entry === "*") return true;
    const bare = entry.startsWith(".") ? entry.slice(1) : entry;
    if (host === bare) return true;
    if (host.endsWith(`.${bare}`)) return true;
  }
  return false;
}

/**
 * Returns a dispatcher to pass as `fetch(url, { dispatcher })`, or undefined
 * to fall through to direct fetch. Pass `targetHostname` to honor NO_PROXY.
 */
export function getDispatcher(targetHostname?: string): Dispatcher | undefined {
  if (cached === null) {
    cached = { agent: buildAgent() };
  }
  if (!cached.agent) return undefined;
  if (targetHostname && noProxyMatches(targetHostname)) return undefined;
  return cached.agent;
}

/** Reset memoized state. Test-only. */
export function __resetDispatcherForTests(): void {
  cached = null;
  warned = false;
}
