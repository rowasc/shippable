import "./LoadModal.css";
import { useRef, useState } from "react";
import type { ChangeSet } from "../types";
import { parseDiff } from "../parseDiff";

interface Props {
  onLoad: (cs: ChangeSet) => void;
  onClose: () => void;
}

export function LoadModal({ onLoad, onClose }: Props) {
  const [url, setUrl] = useState("");
  const [pasted, setPasted] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
    if (!url.trim()) return;
    setErr(null);
    setUrlBusy(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const text = await res.text();
      handleParsedText(text, idFromUrl(url), titleFromUrl(url));
    } catch (e) {
      setErr(e instanceof Error ? `fetch failed: ${e.message}` : "fetch failed");
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

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal__box" onClick={(e) => e.stopPropagation()}>
        <header className="modal__h">
          <span className="modal__h-label">load changeset</span>
          <button className="modal__close" onClick={onClose}>
            × close
          </button>
        </header>

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
              disabled={urlBusy || !url.trim()}
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

        {err && <div className="modal__err">{err}</div>}
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
