import "./ReviewPlanView.css";
import type {
  Claim,
  EntryPoint,
  EvidenceRef,
  ReviewPlan,
  StructureMap,
  StructureMapFile,
} from "../types";
import { Reference } from "./Reference";
import { CopyButton } from "./CopyButton";

interface Props {
  plan: ReviewPlan;
  /** Called when the reviewer chooses an entry point. Optional for gallery use. */
  onJumpToEntry?: (entry: EntryPoint) => void;
  /** Called when any evidence reference is clicked (file, hunk, symbol). */
  onNavigate?: (ev: EvidenceRef) => void;
  /** "idle" before the user has opted in; "loading" while in flight;
   *  "ready" once the AI plan has replaced the rule-based one;
   *  "fallback" if the request errored. Omit for the gallery / rule-only
   *  rendering path. */
  status?: "idle" | "loading" | "ready" | "fallback";
  /** Error message to surface when status === "fallback". */
  error?: string;
  /** Wire this up to whatever sends the diff to the AI provider. The button
   *  is shown when status === "idle" — we don't auto-send because the diff
   *  leaves the user's machine. */
  onGenerateAi?: () => void;
}

export function ReviewPlanView({
  plan,
  onJumpToEntry,
  onNavigate,
  status,
  error,
  onGenerateAi,
}: Props) {
  return (
    <section className="plan">
      <header className="plan__h">
        <div className="plan__h-label">plan</div>
        <h1 className="plan__headline">{plan.headline}</h1>
        {status === "idle" && onGenerateAi && (
          <div className="plan__h-action">
            <button
              type="button"
              className="plan__h-btn"
              onClick={onGenerateAi}
              title="Sends the diff content to Claude over the network"
            >
              Send to Claude
            </button>
            <span className="plan__h-hint">
              the full diff will leave your machine
            </span>
          </div>
        )}
        {status === "loading" && (
          <div className="plan__h-status">Claude is reading the diff…</div>
        )}
        {status === "fallback" && (
          <div className="plan__h-status plan__h-status--err errrow">
            <span className="errrow__msg">
              AI plan failed — showing rule-based fallback{error ? `: ${error}` : ""}
            </span>
            {error && <CopyButton text={error} />}
          </div>
        )}
      </header>

      <IntentSection intent={plan.intent} onNavigate={onNavigate} />
      <MapSection map={plan.map} onNavigate={onNavigate} />
      <EntrySection
        entryPoints={plan.entryPoints}
        files={plan.map.files}
        onJumpToEntry={onJumpToEntry}
        onNavigate={onNavigate}
      />
    </section>
  );
}

function IntentSection({
  intent,
  onNavigate,
}: {
  intent: Claim[];
  onNavigate?: (ev: EvidenceRef) => void;
}) {
  return (
    <section className="plan__sec">
      <div className="plan__sec-h">What this change does</div>
      {intent.length === 0 ? (
        <div className="plan__empty">No intent claims.</div>
      ) : (
        <ul className="plan__claims">
          {intent.map((c, i) => (
            <ClaimRow key={i} claim={c} onNavigate={onNavigate} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ClaimRow({
  claim,
  onNavigate,
}: {
  claim: Claim;
  onNavigate?: (ev: EvidenceRef) => void;
}) {
  // Guard: a claim with no evidence should not render. This is a load-bearing
  // invariant — the whole point is that every claim cites something.
  if (claim.evidence.length === 0) return null;
  return (
    <li className="plan__claim">
      <span className="plan__claim-text">{claim.text}</span>
      <span className="plan__claim-cites">
        {claim.evidence.map((e, i) => (
          <Reference key={i} ev={e} onNavigate={onNavigate} />
        ))}
      </span>
    </li>
  );
}

function MapSection({
  map,
  onNavigate,
}: {
  map: StructureMap;
  onNavigate?: (ev: EvidenceRef) => void;
}) {
  return (
    <section className="plan__sec">
      <div className="plan__sec-h">Map</div>
      <ul className="plan__files">
        {map.files.map((f) => (
          <FileRow
            key={f.fileId}
            file={f}
            defines={symbolsDefinedIn(map, f.path)}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
      {map.symbols.length > 0 && (
        <ul className="plan__symbols">
          {map.symbols.map((s) => (
            <li key={s.name} className="plan__symbol">
              <Reference
                ev={{ kind: "symbol", name: s.name, definedIn: s.definedIn }}
                onNavigate={onNavigate}
              />
              <span className="plan__symbol-arrow">defined in</span>
              <Reference
                ev={{ kind: "file", path: s.definedIn }}
                onNavigate={onNavigate}
              />
              {s.referencedIn.length > 0 && (
                <>
                  <span className="plan__symbol-arrow">→</span>
                  <span className="plan__symbol-refs">
                    {s.referencedIn.map((p) => (
                      <Reference
                        key={p}
                        ev={{ kind: "file", path: p }}
                        onNavigate={onNavigate}
                      />
                    ))}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function symbolsDefinedIn(map: StructureMap, path: string): string[] {
  return map.symbols.filter((s) => s.definedIn === path).map((s) => s.name);
}

function FileRow({
  file,
  defines,
  onNavigate,
}: {
  file: StructureMapFile;
  defines: string[];
  onNavigate?: (ev: EvidenceRef) => void;
}) {
  return (
    <li className="plan__file">
      <span className={`plan__file-status plan__file-status--${file.status}`}>
        {statusGlyph(file.status)}
      </span>
      <Reference
        ev={{ kind: "file", path: file.path }}
        onNavigate={onNavigate}
      />
      <span className="plan__file-counts">
        {file.added > 0 && <span className="plan__add">+{file.added}</span>}
        {file.removed > 0 && <span className="plan__del">−{file.removed}</span>}
      </span>
      {file.isTest && <span className="plan__badge">test</span>}
      {defines.length > 0 && (
        <span className="plan__file-defs">
          defines{" "}
          {defines.map((name) => (
            <Reference
              key={name}
              ev={{ kind: "symbol", name, definedIn: file.path }}
              onNavigate={onNavigate}
            />
          ))}
        </span>
      )}
    </li>
  );
}

function statusGlyph(status: StructureMapFile["status"]): string {
  switch (status) {
    case "added":
      return "+";
    case "deleted":
      return "−";
    case "renamed":
      return "↻";
    case "modified":
    default:
      return "~";
  }
}

function EntrySection({
  entryPoints,
  files,
  onJumpToEntry,
  onNavigate,
}: {
  entryPoints: EntryPoint[];
  files: StructureMapFile[];
  onJumpToEntry?: (entry: EntryPoint) => void;
  onNavigate?: (ev: EvidenceRef) => void;
}) {
  return (
    <section className="plan__sec">
      <div className="plan__sec-h">Start here</div>
      {entryPoints.length === 0 ? (
        <div className="plan__empty">
          No clear entry point — the diff is flat. Open any file to begin.
        </div>
      ) : (
        <ol className="plan__entries">
          {entryPoints.map((e, i) => {
            const f = files.find((x) => x.fileId === e.fileId);
            return (
              <li key={e.fileId} className="plan__entry">
                <button
                  className="plan__entry-btn"
                  onClick={onJumpToEntry ? () => onJumpToEntry(e) : undefined}
                  disabled={!onJumpToEntry}
                >
                  <span className="plan__entry-rank">{i + 1}</span>
                  <span className="plan__entry-path">{f?.path ?? e.fileId}</span>
                </button>
                <div className="plan__entry-reason">
                  <span className="plan__claim-text">{e.reason.text}</span>
                  <span className="plan__claim-cites">
                    {e.reason.evidence.map((ev, j) => (
                      <Reference key={j} ev={ev} onNavigate={onNavigate} />
                    ))}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
