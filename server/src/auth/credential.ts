// Shared credential discriminator used by the auth-store, /api/auth/* handlers,
// and any consumer that needs to address a credential by its kind.
//
// The wire form is the tagged-union `Credential`; the on-disk Map key is the
// flat string `encodeStoreKey` returns. Keeping the two split lets future kinds
// extend the union without re-encoding existing entries.

export type Credential =
  | { kind: "anthropic" }
  | { kind: "github"; host: string };

function normalizeHost(host: string): string {
  return host.trim().toLowerCase();
}

export function encodeStoreKey(credential: Credential): string {
  switch (credential.kind) {
    case "anthropic":
      return "anthropic";
    case "github": {
      const host = normalizeHost(credential.host);
      if (!host) {
        throw new Error("encodeStoreKey: github credential requires a non-empty host");
      }
      return `github:${host}`;
    }
  }
}

export function decodeStoreKey(key: string): Credential {
  if (key === "anthropic") return { kind: "anthropic" };
  if (key.startsWith("github:")) {
    const host = key.slice("github:".length);
    if (!host) {
      throw new Error(`decodeStoreKey: empty github host in "${key}"`);
    }
    return { kind: "github", host };
  }
  throw new Error(`decodeStoreKey: unknown store key "${key}"`);
}
