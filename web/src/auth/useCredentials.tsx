/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { authList, authSet, authClear } from "./client";
import {
  isTauri,
  keychainGet,
  keychainSet,
  keychainRemove,
} from "../keychain";
import { readTrustedGithubHosts } from "../githubHostTrust";
import { keychainAccountFor, type Credential } from "./credential";

const SKIP_KEY = "shippable:anthropic:skip";

export type CredentialsStatus = "loading" | "ready" | "error";

export interface CredentialsApi {
  list: Credential[];
  status: CredentialsStatus;
  anthropicSkipped: boolean;
  rehydrate: () => Promise<void>;
  set: (credential: Credential, value: string) => Promise<void>;
  clear: (credential: Credential) => Promise<void>;
  skipAnthropic: () => void;
}

const CredentialsContext = createContext<CredentialsApi | null>(null);

function readSkip(): boolean {
  try {
    return window.localStorage.getItem(SKIP_KEY) === "true";
  } catch {
    return false;
  }
}

function writeSkip(value: boolean): void {
  try {
    if (value) window.localStorage.setItem(SKIP_KEY, "true");
    else window.localStorage.removeItem(SKIP_KEY);
  } catch {
    // localStorage may be unavailable in some embeds; the user can re-skip.
  }
}

export function CredentialsProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Credential[]>([]);
  const [status, setStatus] = useState<CredentialsStatus>("loading");
  const [anthropicSkipped, setAnthropicSkipped] = useState<boolean>(() =>
    readSkip(),
  );
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const fresh = await authList();
      if (mounted.current) {
        setList(fresh);
        setStatus("ready");
      }
    } catch {
      if (mounted.current) setStatus("error");
    }
  }, []);

  const rehydrate = useCallback(async () => {
    if (isTauri()) {
      const candidates: Credential[] = [
        { kind: "anthropic" },
        { kind: "github", host: "github.com" },
        ...readTrustedGithubHosts().map(
          (host): Credential => ({ kind: "github", host }),
        ),
      ];
      for (const credential of candidates) {
        try {
          const value = await keychainGet(keychainAccountFor(credential));
          if (value) {
            await authSet(credential, value);
          }
        } catch {
          // Silent — Keychain miss / read error doesn't prompt at boot.
        }
      }
    }
    await refresh();
  }, [refresh]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void rehydrate();
  }, [rehydrate]);

  const set = useCallback(
    async (credential: Credential, value: string) => {
      if (isTauri()) {
        await keychainSet(keychainAccountFor(credential), value);
      }
      await authSet(credential, value);
      if (credential.kind === "anthropic") {
        writeSkip(false);
        if (mounted.current) setAnthropicSkipped(false);
      }
      await refresh();
    },
    [refresh],
  );

  const clear = useCallback(
    async (credential: Credential) => {
      if (isTauri()) {
        await keychainRemove(keychainAccountFor(credential));
      }
      await authClear(credential);
      await refresh();
    },
    [refresh],
  );

  const skipAnthropic = useCallback(() => {
    writeSkip(true);
    setAnthropicSkipped(true);
  }, []);

  const value = useMemo<CredentialsApi>(
    () => ({
      list,
      status,
      anthropicSkipped,
      rehydrate,
      set,
      clear,
      skipAnthropic,
    }),
    [list, status, anthropicSkipped, rehydrate, set, clear, skipAnthropic],
  );

  return (
    <CredentialsContext.Provider value={value}>
      {children}
    </CredentialsContext.Provider>
  );
}

export function useCredentials(): CredentialsApi {
  const ctx = useContext(CredentialsContext);
  if (!ctx) {
    throw new Error(
      "useCredentials must be used within a CredentialsProvider",
    );
  }
  return ctx;
}
