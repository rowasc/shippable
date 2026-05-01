import "./LoadModal.css";
import { useEffect, useRef, useState } from "react";
import type { ChangeSet } from "../types";
import { parseDiff } from "../parseDiff";
import { apiUrl } from "../apiUrl";
import { CopyButton } from "./CopyButton";

interface Props {
  onLoad: (cs: ChangeSet) => void;
  onClose: () => void;
}

// PROTOTYPE: localStorage key for the last-used worktrees parent dir.
const WORKTREES_DIR_KEY = "shippable.worktreesDir";

interface Worktree {
  path: string;
  branch: string | null;
  head: string;
  isMain: boolean;
}

export function LoadModal({ onLoad, onClose }: Props) {
  const [url, setUrl] = useState("");
  const [pasted, setPasted] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Worktrees pane state. The whole pane hides itself if a probe of
  // /api/health on mount fails — keeps the browser-only fallback clean.
  const [serverAvailable, setServerAvailable] = useState<boolean | null>(null);
  const [wtDir, setWtDir] = useState(
    () => localStorage.getItem(WORKTREES_DIR_KEY) ?? "",
  );
  const [wtBusy, setWtBusy] = useState(false);
  const [wtList, setWtList] = useState<Worktree[] | null>(null);
  const [wtLoadingPath, setWtLoadingPath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(await apiUrl("/api/health"));
        if (!cancelled) setServerAvailable(res.ok);
      } catch {
        if (!cancelled) setServerAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const urlIsValid = isValidHttpUrl(url);

  /** Outside-click should not yank a long pasted diff or a typed URL out
   *  from under the user — only close when there's nothing to lose. */
  function tryCloseFromBackdrop() {
    if (url.trim() || pasted.trim()) return;
    onClose();
  }

  function handleParsedText(text: string, id: string, title?: string) {
    try {
      const cs = parseDiff(text, { id, title });
      if (cs.files.length === 0) {
        setErr("No files parsed from that diff — is it empty or malformed?");
        return;
      }
      onLoad(cs);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "parse failed");
    }
  }

  async function loadFromUrl() {
    if (!urlIsValid) return;
    setErr(null);
    setUrlBusy(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const text = await res.text();
      handleParsedText(text, idFromUrl(url), titleFromUrl(url));
    } catch (e) {
      // TypeError on the fetch promise typically means CORS / network
      // refused — distinguish so users don't waste time looking for a
      // status code that won't ever come.
      const isLikelyCors = e instanceof TypeError;
      const msg = e instanceof Error ? e.message : String(e);
      setErr(
        isLikelyCors
          ? `Couldn't reach that URL — likely a CORS rejection from the host. Check devtools for the network error, or download the diff and use Upload.`
          : `fetch failed: ${msg}`,
      );
    } finally {
      setUrlBusy(false);
    }
  }

  async function loadFromFile(f: File) {
    setErr(null);
    try {
      const text = await f.text();
      handleParsedText(text, idFromFilename(f.name), f.name);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "read failed");
    }
  }

  function loadFromPaste() {
    if (!pasted.trim()) return;
    setErr(null);
    handleParsedText(pasted, `pasted-${Date.now().toString(36)}`, "pasted diff");
  }

  async function scanWorktrees() {
    const dir = wtDir.trim();
    if (!dir) return;
    setErr(null);
    setWtBusy(true);
    setWtList(null);
    try {
      const res = await fetch(await apiUrl("/api/worktrees/list"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir }),
      });
      const json = (await res.json()) as
        | { worktrees: Worktree[] }
        | { error: string };
      if (!res.ok || "error" in json) {
        throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
      }
      localStorage.setItem(WORKTREES_DIR_KEY, dir);
      setWtList(json.worktrees);
      if (json.worktrees.length === 0) {
        setErr(`No worktrees found in ${dir}.`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(`Scan failed: ${msg}`);
    } finally {
      setWtBusy(false);
    }
  }

  async function loadFromWorktree(wt: Worktree) {
    setErr(null);
    setWtLoadingPath(wt.path);
    try {
      const res = await fetch(await apiUrl("/api/worktrees/changeset"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: wt.path }),
      });
      const json = (await res.json()) as
        | {
            diff: string;
            sha: string;
            subject: string;
            author: string;
            date: string;
            branch: string | null;
            fileContents?: Record<string, string>;
          }
        | { error: string };
      if (!res.ok || "error" in json) {
        throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
      }
      try {
        const cs = parseDiff(json.diff, {
          id: `wt-${json.sha.slice(0, 12)}`,
          title: json.subject || `${wt.branch ?? "detached"} @ ${json.sha.slice(0, 7)}`,
          author: json.author,
          head: json.branch ?? json.sha.slice(0, 7),
          fileContents: json.fileContents,
        });
        if (cs.files.length === 0) {
          setErr("Latest commit produced no parseable diff (empty or merge?).");
          return;
        }
        onLoad(cs);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "parse failed");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(`Load failed: ${msg}`);
    } finally {
      setWtLoadingPath(null);
    }
  }

  return (
    <div className="modal" onClick={tryCloseFromBackdrop}>
      <div className="modal__box" onClick={(e) => e.stopPropagation()}>
        <header className="modal__h">
          <span className="modal__h-label">load changeset</span>
          <button className="modal__close" onClick={onClose}>
            × close
          </button>
        </header>

        {/* Worktrees pane: only renders when the local server is reachable.
         *  In no-server / browser-only modes this section is hidden and the
         *  three classic loaders below remain fully functional. */}
        {serverAvailable && (
          <section className="modal__sec">
            <div className="modal__sec-h">From a worktrees directory</div>
            <p className="modal__hint">
              Absolute path to a directory containing one or more git worktrees
              (e.g. a repo root, or <code>.claude/worktrees</code>). Reads the
              latest commit on the worktree you pick.
            </p>
            <div className="modal__row">
              <input
                className="modal__input"
                type="text"
                placeholder="/Users/you/code/my-repo"
                value={wtDir}
                onChange={(e) => setWtDir(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && scanWorktrees()}
              />
              <button
                className="modal__btn modal__btn--primary"
                onClick={scanWorktrees}
                disabled={wtBusy || !wtDir.trim()}
              >
                {wtBusy ? "scanning…" : "scan"}
              </button>
            </div>
            {wtList && wtList.length > 0 && (
              <ul className="modal__wt-list">
                {wtList.map((wt) => (
                  <li key={wt.path}>
                    <button
                      type="button"
                      className="modal__wt-row"
                      onClick={() => loadFromWorktree(wt)}
                      disabled={wtLoadingPath !== null}
                    >
                      <span className="modal__wt-branch">
                        {wt.branch ?? "(detached)"}
                        {wt.isMain && (
                          <span className="modal__wt-tag"> main</span>
                        )}
                      </span>
                      <span className="modal__wt-path">{wt.path}</span>
                      <span className="modal__wt-head">
                        {wt.head.slice(0, 7)}
                        {wtLoadingPath === wt.path && " · loading…"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="modal__sec">
          <div className="modal__sec-h">From URL</div>
          <p className="modal__hint">
            Any URL serving a unified diff. GitHub PRs work by appending{" "}
            <code>.diff</code> or <code>.patch</code>. Subject to CORS.
          </p>
          <div className="modal__row">
            <input
              className="modal__input"
              type="url"
              placeholder="https://github.com/owner/repo/pull/123.diff"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadFromUrl()}
            />
            <button
              className="modal__btn modal__btn--primary"
              onClick={loadFromUrl}
              disabled={urlBusy || !urlIsValid}
              title={
                !urlIsValid && url.trim()
                  ? "URL must start with http:// or https://"
                  : undefined
              }
            >
              {urlBusy ? "loading…" : "load"}
            </button>
          </div>
        </section>

        <section className="modal__sec">
          <div className="modal__sec-h">Upload a file</div>
          <p className="modal__hint">
            Drop or select a <code>.diff</code> / <code>.patch</code> file.
          </p>
          <div className="modal__row">
            <input
              ref={fileRef}
              type="file"
              accept=".diff,.patch,text/plain"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) loadFromFile(f);
              }}
              className="modal__file"
            />
          </div>
        </section>

        <section className="modal__sec">
          <div className="modal__sec-h">Paste diff text</div>
          <textarea
            className="modal__textarea"
            placeholder={"diff --git a/foo b/foo\n--- a/foo\n+++ b/foo\n@@ -1 +1 @@\n-old\n+new"}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={6}
          />
          <div className="modal__row modal__row--end">
            <button
              className="modal__btn"
              onClick={loadFromPaste}
              disabled={!pasted.trim()}
            >
              parse
            </button>
          </div>
        </section>

        {err && (
          <div className="modal__err errrow">
            <span className="errrow__msg">{err}</span>
            <CopyButton text={err} />
          </div>
        )}
      </div>
    </div>
  );
}

function idFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() ?? "loaded";
    return last.replace(/\.(diff|patch)$/i, "") || "loaded";
  } catch {
    return `loaded-${Date.now().toString(36)}`;
  }
}

function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return url;
  }
}

function idFromFilename(name: string): string {
  return name.replace(/\.(diff|patch)$/i, "") || `file-${Date.now().toString(36)}`;
}

/** Pre-flight check before the fetch — disables the load button when
 *  the field is empty or obviously not an http(s) URL. */
function isValidHttpUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
