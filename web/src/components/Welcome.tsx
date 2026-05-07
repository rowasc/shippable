import "./Welcome.css";
import { useRef, useState } from "react";
import type { ChangeSet, Reply } from "../types";
import { parseDiff } from "../parseDiff";
import { STUBS } from "../fixtures";
import type { RecentEntry, RecentSource } from "../recents";
import { removeRecent } from "../recents";
import { useWorktreeLoader } from "../useWorktreeLoader";

interface Props {
  recents: RecentEntry[];
  /** The reviewer picked something (recent, stub, or freshly parsed). */
  onLoad: (
    cs: ChangeSet,
    replies: Record<string, Reply[]>,
    source: RecentSource,
  ) => void;
  /** Notify parent so it re-reads recents from storage. */
  onRecentsChange: (next: RecentEntry[]) => void;
}

export function Welcome({ recents, onLoad, onRecentsChange }: Props) {
  const [err, setErr] = useState<string | null>(null);

  // URL pane.
  const [url, setUrl] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);

  // Paste pane.
  const [pasted, setPasted] = useState("");

  // Drop zone.
  const [dropActive, setDropActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function deliver(
    cs: ChangeSet,
    replies: Record<string, Reply[]>,
    source: RecentSource,
  ) {
    onLoad(cs, replies, source);
  }

  function handleParsed(text: string, id: string, title: string | undefined, source: RecentSource) {
    try {
      const cs = parseDiff(text, { id, title });
      if (cs.files.length === 0) {
        setErr("No files parsed from that diff — is it empty or malformed?");
        return;
      }
      deliver(cs, {}, source);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "parse failed");
    }
  }

  async function loadFromUrl() {
    if (!isValidHttpUrl(url)) return;
    setErr(null);
    setUrlBusy(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const text = await res.text();
      handleParsed(text, idFromUrl(url), titleFromUrl(url), { kind: "url", url });
    } catch (e) {
      const isLikelyCors = e instanceof TypeError;
      const msg = e instanceof Error ? e.message : String(e);
      setErr(
        isLikelyCors
          ? `${hostFromUrl(url)} blocks browser fetches with CORS — common for GitHub raw URLs. Save the diff to a file (e.g. \`gh pr diff <num> > pr.diff\`) and load it from the file input or paste box below.`
          : `Couldn't fetch the URL: ${msg}`,
      );
    } finally {
      setUrlBusy(false);
    }
  }

  async function loadFromFile(f: File) {
    setErr(null);
    try {
      const text = await f.text();
      handleParsed(text, idFromFilename(f.name), f.name, {
        kind: "file",
        filename: f.name,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "read failed");
    }
  }

  function loadFromPaste() {
    if (!pasted.trim()) return;
    setErr(null);
    handleParsed(pasted, `pasted-${Date.now().toString(36)}`, "pasted diff", {
      kind: "paste",
    });
  }

  const worktrees = useWorktreeLoader({
    onLoad: (cs, source) => deliver(cs, {}, source),
  });

  function loadFromRecent(r: RecentEntry) {
    deliver(r.changeset, r.replies, r.source);
  }

  function dismissRecent(id: string) {
    onRecentsChange(removeRecent(id));
  }

  return (
    <div className="welcome">
      <header className="welcome__top">
        <span className="welcome__brand">shippable</span>
        <span className="welcome__sep">│</span>
        <span className="welcome__sub">an AI-assisted code review prototype</span>
      </header>

      <div className="welcome__body">
        {recents.length > 0 && (
          <section className="welcome__recents">
            <h2 className="welcome__sec-h">Recent</h2>
            <ul className="welcome__recents-list">
              {recents.map((r) => (
                <li key={r.id} className="welcome__recent">
                  <button
                    type="button"
                    className="welcome__recent-open"
                    onClick={() => loadFromRecent(r)}
                  >
                    <span className="welcome__recent-title">{r.title}</span>
                    <span className="welcome__recent-meta">
                      {sourceLabel(r.source)} · {timeAgo(r.addedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="welcome__recent-x"
                    aria-label={`forget ${r.title}`}
                    title="forget this entry"
                    onClick={() => dismissRecent(r.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Hero swaps based on capability: worktree picker when the local
            server is up; drop-zone otherwise. The other inputs render below
            either way. */}
        {worktrees.serverAvailable === true ? (
          <section className="welcome__hero welcome__wt">
            <h1 className="welcome__hero-h">Open a local branch</h1>
            <p className="welcome__hero-sub">
              Choose a repo root or worktrees folder. Shippable scans it and
              loads the latest committed diff from the worktree you pick.
            </p>
            <div className="welcome__wt-actions">
              <button
                className="welcome__btn welcome__btn--primary"
                onClick={worktrees.pickDirectory}
                disabled={worktrees.wtPickerBusy}
              >
                {worktrees.wtPickerBusy ? "opening…" : "choose folder…"}
              </button>
              {worktrees.wtDir.trim() && (
                <button
                  className="welcome__btn"
                  onClick={() => worktrees.scanWorktrees()}
                  disabled={worktrees.wtBusy}
                >
                  {worktrees.wtBusy ? "scanning…" : "rescan"}
                </button>
              )}
              <button
                className="welcome__btn"
                onClick={() => worktrees.setShowManualPath((shown) => !shown)}
              >
                {worktrees.showManualPath ? "hide path input" : "paste path instead"}
              </button>
            </div>
            {worktrees.wtDir.trim() && (
              <div className="welcome__wt-picked">
                Current folder: <code>{worktrees.wtDir}</code>
              </div>
            )}
            {worktrees.showManualPath && (
              <div className="welcome__wt-manual">
                <div className="welcome__wt-row">
                  <input
                    className="welcome__input"
                    type="text"
                    placeholder="/Users/you/code/my-repo"
                    value={worktrees.wtDir}
                    onChange={(e) => worktrees.setWtDir(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && worktrees.scanWorktrees()
                    }
                    autoFocus
                  />
                  <button
                    className="welcome__btn"
                    onClick={() => worktrees.scanWorktrees()}
                    disabled={worktrees.wtBusy || !worktrees.wtDir.trim()}
                  >
                    {worktrees.wtBusy ? "scanning…" : "scan"}
                  </button>
                </div>
              </div>
            )}
            {worktrees.err && <div className="welcome__err">{worktrees.err}</div>}
            {worktrees.wtList && worktrees.wtList.length > 0 && (
              <ul className="welcome__wt-list modal__wt-list">
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
                        {wt.isMain && <span className="modal__wt-tag"> main</span>}
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
        ) : (
          <section className="welcome__hero">
            <h1 className="welcome__hero-h">Drop in a diff to start</h1>
            <p className="welcome__hero-sub">
              Drop a <code>.diff</code> or <code>.patch</code> file here, or use
              one of the loaders below.
            </p>
            <label
              className={`welcome__drop ${dropActive ? "welcome__drop--active" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDropActive(true);
              }}
              onDragLeave={() => setDropActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDropActive(false);
                const f = e.dataTransfer.files?.[0];
                if (f) loadFromFile(f);
              }}
            >
              <span className="welcome__drop-strong">drop a diff here</span>
              <span> or </span>
              <span className="welcome__drop-strong">click to choose a file</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".diff,.patch,text/plain"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) loadFromFile(f);
                }}
              />
            </label>
          </section>
        )}

        {/* Always-on secondary loaders. */}
        <section className="welcome__sec">
          <h2 className="welcome__sec-h">From a URL</h2>
          <div className="welcome__row">
            <input
              className="welcome__input"
              type="url"
              placeholder="https://github.com/owner/repo/pull/123.diff"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadFromUrl()}
            />
            <button
              className="welcome__btn"
              onClick={loadFromUrl}
              disabled={urlBusy || !isValidHttpUrl(url)}
            >
              {urlBusy ? "loading…" : "load"}
            </button>
          </div>
        </section>

        {worktrees.serverAvailable === true && (
          <section className="welcome__sec">
            <h2 className="welcome__sec-h">From a file</h2>
            <input
              type="file"
              accept=".diff,.patch,text/plain"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) loadFromFile(f);
              }}
            />
          </section>
        )}

        <section className="welcome__sec">
          <h2 className="welcome__sec-h">Paste a diff</h2>
          <textarea
            className="welcome__textarea"
            placeholder={"diff --git a/foo b/foo\n--- a/foo\n+++ b/foo\n@@ -1 +1 @@\n-old\n+new"}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={6}
          />
          <div className="welcome__row" style={{ justifyContent: "flex-end" }}>
            <button
              className="welcome__btn"
              onClick={loadFromPaste}
              disabled={!pasted.trim()}
            >
              parse
            </button>
          </div>
        </section>

        {err && <div className="welcome__err">{err}</div>}

        {STUBS.length > 0 && (
          <section className="welcome__samples">
            <span className="welcome__samples-label">
              Or explore with a built-in sample:
            </span>
            {STUBS.map((s) => (
              <button
                key={s.code}
                type="button"
                className="welcome__sample"
                onClick={() =>
                  deliver(s.changeset, s.replies, { kind: "stub", code: s.code })
                }
                title={s.changeset.title}
              >
                {s.code} · {s.changeset.title}
              </button>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

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

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function idFromFilename(name: string): string {
  return name.replace(/\.(diff|patch)$/i, "") || `file-${Date.now().toString(36)}`;
}

function sourceLabel(s: RecentSource): string {
  switch (s.kind) {
    case "url":
      return new URL(s.url).hostname;
    case "file":
      return s.filename;
    case "paste":
      return "pasted";
    case "worktree":
      return s.branch ?? s.path;
    case "stub":
      return `sample ${s.code}`;
  }
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
