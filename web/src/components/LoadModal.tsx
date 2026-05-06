import "./LoadModal.css";
import { useRef, useState } from "react";
import type { ChangeSet } from "../types";
import { parseDiff } from "../parseDiff";
import type { RecentSource } from "../recents";
import { useWorktreeLoader } from "../useWorktreeLoader";
import { CopyButton } from "./CopyButton";

interface Props {
  /**
   * Keep both the parsed ChangeSet and the actual load provenance.
   * Definition-nav and recents both need the real source shape, and
   * worktree-backed loads should not get collapsed into "paste".
   */
  onLoad: (cs: ChangeSet, source: RecentSource) => void;
  onClose: () => void;
}

export function LoadModal({ onLoad, onClose }: Props) {
  const [url, setUrl] = useState("");
  const [pasted, setPasted] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const urlIsValid = isValidHttpUrl(url);

  /** Outside-click should not yank a long pasted diff or a typed URL out
   *  from under the user — only close when there's nothing to lose. */
  function tryCloseFromBackdrop() {
    if (url.trim() || pasted.trim()) return;
    onClose();
  }

  function handleParsedText(
    text: string,
    id: string,
    source: RecentSource,
    title?: string,
  ) {
    try {
      const cs = parseDiff(text, { id, title });
      if (cs.files.length === 0) {
        setErr("No files parsed from that diff — is it empty or malformed?");
        return;
      }
      onLoad(cs, source);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "parse failed");
    }
  }

  const worktrees = useWorktreeLoader({
    onLoad: (cs: ChangeSet, source: RecentSource) => onLoad(cs, source),
  });

  async function loadFromUrl() {
    if (!urlIsValid) return;
    setErr(null);
    setUrlBusy(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const text = await res.text();
      handleParsedText(text, idFromUrl(url), { kind: "url", url }, titleFromUrl(url));
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
      handleParsedText(text, idFromFilename(f.name), {
        kind: "file",
        filename: f.name,
      }, f.name);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "read failed");
    }
  }

  function loadFromPaste() {
    if (!pasted.trim()) return;
    setErr(null);
    handleParsedText(
      pasted,
      `pasted-${Date.now().toString(36)}`,
      { kind: "paste" },
      "pasted diff",
    );
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
        {worktrees.serverAvailable && (
          <section className="modal__sec">
            <div className="modal__sec-h">From a local repo or worktrees folder</div>
            <p className="modal__hint">
              Choose a repo root or worktrees folder. Shippable scans it and
              loads the latest committed diff from the worktree you pick.
            </p>
            <div className="modal__picker-actions">
              <button
                className="modal__btn modal__btn--primary"
                onClick={worktrees.pickDirectory}
                disabled={worktrees.wtPickerBusy}
              >
                {worktrees.wtPickerBusy ? "opening…" : "choose folder…"}
              </button>
              {worktrees.wtDir.trim() && (
                <button
                  className="modal__btn"
                  onClick={() => worktrees.scanWorktrees()}
                  disabled={worktrees.wtBusy}
                >
                  {worktrees.wtBusy ? "scanning…" : "rescan"}
                </button>
              )}
              <button
                className="modal__btn"
                onClick={() => worktrees.setShowManualPath((shown) => !shown)}
              >
                {worktrees.showManualPath ? "hide path input" : "paste path instead"}
              </button>
            </div>
            {worktrees.wtDir.trim() && (
              <div className="modal__picked-path">
                Current folder: <code>{worktrees.wtDir}</code>
              </div>
            )}
            {worktrees.showManualPath && (
              <div className="modal__manual">
                <div className="modal__row">
                  <input
                    className="modal__input"
                    type="text"
                    placeholder="/Users/you/code/my-repo"
                    value={worktrees.wtDir}
                    onChange={(e) => worktrees.setWtDir(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && worktrees.scanWorktrees()
                    }
                  />
                  <button
                    className="modal__btn"
                    onClick={() => worktrees.scanWorktrees()}
                    disabled={worktrees.wtBusy || !worktrees.wtDir.trim()}
                  >
                    {worktrees.wtBusy ? "scanning…" : "scan"}
                  </button>
                </div>
              </div>
            )}
            {worktrees.err && (
              <p className="modal__hint modal__hint--error">{worktrees.err}</p>
            )}
            {worktrees.wtList && worktrees.wtList.length > 0 && (
              <ul className="modal__wt-list">
                {worktrees.wtList.map((wt) => (
                  <li key={wt.path}>
                    <button
                      type="button"
                      className="modal__wt-row"
                      onClick={() => worktrees.loadFromWorktree(wt)}
                      disabled={worktrees.wtLoadingPath !== null}
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
                        {worktrees.wtLoadingPath === wt.path && " · loading…"}
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
