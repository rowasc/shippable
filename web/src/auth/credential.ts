// Shared credential discriminator used by /api/auth/*, the useCredentials hook,
// and the Tauri Keychain bridge. Mirrors the server's `Credential` type.

export type Credential =
  | { kind: "anthropic" }
  | { kind: "github"; host: string };

/**
 * Maps a `Credential` to the Tauri Keychain `account` identifier. The single
 * source of truth for this naming; consumers (boot rehydrate, useCredentials,
 * reactive GH modal) all funnel through it.
 */
export function keychainAccountFor(credential: Credential): string {
  switch (credential.kind) {
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "github":
      return `GITHUB_TOKEN:${credential.host.trim().toLowerCase()}`;
  }
}
