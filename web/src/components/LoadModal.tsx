import "./LoadModal.css";
import { useRef, useState } from "react";
import type { ChangeSet, DetachedReply, Reply } from "../types";
import { parseDiff } from "../parseDiff";
import type { RecentSource } from "../recents";
import { useWorktreeLoader } from "../useWorktreeLoader";
import type { LoadOpts } from "../worktreeChangeset";
import { CopyButton } from "./CopyButton";
import { RangePicker } from "./RangePicker";
import { useGithubPrLoad, isGithubPrUrl } from "../useGithubPrLoad";
import { GitHubTokenModal } from "./GitHubTokenModal";

interface Props {
  /**
   * Keep both the parsed ChangeSet and the actual load provenance.
   * Definition-nav and recents both need the real source shape, and
   * worktree-backed loads should not get collapsed into "paste".
   * `prData` is set only on GitHub PR loads — carries the bucketed PR-
   * sourced replies + detached entries the parent should merge in.
   */
  onLoad: (
    cs: ChangeSet,
    source: RecentSource,
    prData?: { prReplies: Record<string, Reply[]>; prDetached: DetachedReply[] },
  ) => void;
  onClose: () => void;
}

export function LoadModal({ onLoad, onClose }: Props) {
  const [url, setUrl] = useState("");
  const [pasted, setPasted] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pickerForPath, setPickerForPath] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pr = useGithubPrLoad({
    onResult: (result, prUrl) => {
      onLoad(result.changeSet, { kind: "pr", prUrl }, {
        prReplies: result.prReplies,
        prDetached: result.prDetached,
      });
    },
  });

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

  // Empty-diff loads (branch at parity, picked merge commit, etc.) auto-open
  // the range picker for that row — let the user choose a different slice
  // instead of staring at an error.
  function isPickerOpenFor(p: string): boolean {
    return pickerForPath === p || worktrees.wtEmpty?.path === p;
  }
  function togglePicker(p: string) {
    if (isPickerOpenFor(p)) {
      setPickerForPath(null);
      worktrees.clearWtEmpty();
    } else {
      setPickerForPath(p);
    }
  }

  async function loadFromUrl() {
    if (!urlIsValid) return;
    setErr(null);
    // PR HTML URLs route through the server-side GitHub flow; raw
    // diff/patch URLs hit the browser fetch path below.
    if (isGithubPrUrl(url)) {
      await pr.loadPr(url);
      return;
    }
    setUrlBusy(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const text = await res.text();
      handleParsedText(text, idFromUrl(url), { kind: "url", url }, titleFromUrl(url));
    } catch (e) {
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
      <div
        className="modal__box"
        role="dialog"
        aria-modal="true"
        aria-label="load changeset"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Global keymap bails out when focus is on an input/textarea, so
          // Escape inside this modal's fields would have nowhere to go.
          // Handle it locally.
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="modal__h">
          <span className="modal__h-label">load changeset</span>
          <button className="modal__close" onClick={onClose}>
            × close
          </button>
        </header>

        {/* Worktrees pane: only renders when the local server is reachable.
         *  In no-server / browser-only modes this section is hidden and the
         *  three classic loaders below remain fully functional. */}
        {pr.tokenModal && (
          <GitHubTokenModal
            host={pr.tokenModal.host}
            reason={pr.tokenModal.reason}
            onSubmit={pr.submitToken}
            onCancel={pr.dismissTokenModal}
          />
        )}

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
                    <div className="modal__wt-row-wrap">
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
                      <button
                        type="button"
                        className="modal__wt-pick-range"
                        onClick={() => togglePicker(wt.path)}
                        disabled={worktrees.wtLoadingPath !== null}
                        aria-expanded={isPickerOpenFor(wt.path)}
                      >
                        {isPickerOpenFor(wt.path) ? "close" : "pick range…"}
                      </button>
                    </div>
                    {worktrees.wtEmpty?.path === wt.path && (
                      <p className="modal__hint modal__hint--empty">
                        {worktrees.wtEmpty.message} Pick a range below to
                        compare commits.
                      </p>
                    )}
                    {isPickerOpenFor(wt.path) && (
                      <RangePicker
                        worktreePath={wt.path}
                        fetchCommits={worktrees.fetchCommits}
                        defaultToRef="HEAD"
                        busy={worktrees.wtLoadingPath === wt.path}
                        onApply={(opts: LoadOpts) => {
                          setPickerForPath(null);
                          worktrees.clearWtEmpty();
                          void worktrees.loadFromWorktree(wt, opts);
                        }}
                        onCancel={() => {
                          setPickerForPath(null);
                          worktrees.clearWtEmpty();
                        }}
                        onJustThis={(sha: string) => {
                          setPickerForPath(null);
                          worktrees.clearWtEmpty();
                          void worktrees.loadFromWorktree(wt, {
                            kind: "ref",
                            ref: sha,
                          });
                        }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="modal__sec">
          <div className="modal__sec-h">From URL</div>
          <p className="modal__hint">
            A GitHub PR URL (routed through your local server, prompts for a
            Personal Access Token on first use per host) or any URL serving a
            unified diff (subject to CORS).
          </p>
          <div className="modal__row">
            <input
              className="modal__input"
              type="url"
              placeholder="https://github.com/owner/repo/pull/123"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadFromUrl()}
              aria-invalid={url.trim() !== "" && !urlIsValid}
            />
            <button
              className="modal__btn modal__btn--primary"
              onClick={loadFromUrl}
              disabled={urlBusy || pr.busy || !urlIsValid}
            >
              {urlBusy || pr.busy ? "loading…" : "load"}
            </button>
          </div>
          {url.trim() !== "" && !urlIsValid && (
            <p className="modal__hint modal__hint--error">
              URL must start with <code>http://</code> or <code>https://</code>.
            </p>
          )}
          {pr.error && (
            <p className="modal__hint modal__hint--error">{pr.error}</p>
          )}
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
