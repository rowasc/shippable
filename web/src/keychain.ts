// Tauri Keychain helpers. Import from here rather than inline-importing
// @tauri-apps/api/core at each call site — keeps the isTauri() guard in one
// place for any new code that needs it.

export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(
      (window as unknown as { __TAURI_INTERNALS__?: unknown })
        .__TAURI_INTERNALS__,
    )
  );
}

export async function keychainGet(account: string): Promise<string | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("keychain_get", { account });
}

export async function keychainSet(
  account: string,
  password: string,
): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke<void>("keychain_set", { account, password });
}
