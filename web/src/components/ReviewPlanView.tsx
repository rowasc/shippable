import { useMemo, useState } from "react";
import "./ReviewPlanView.css";
import type {
  Claim,
  EntryPoint,
  EvidenceRef,
  ReviewPlan,
  StructureMap,
  StructureMapFile,
  ChangeSet,
  ChangeSetCommit,
  CodeGraphNode,
} from "../types";
import { buildPlanDiagram } from "../planDiagram";
import { Reference } from "./Reference";
import { CopyButton } from "./CopyButton";
import { PlanDiagramView } from "./PlanDiagramView";
import { MarkdownView } from "./MarkdownView";

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
  changeset?: ChangeSet;
}

export function ReviewPlanView({
  plan,
  onJumpToEntry,
  onNavigate,
  status,
  error,
  onGenerateAi,
  changeset,
}: Props) {
  const [showDiagram, setShowDiagram] = useState(false);
  const [includeMarkdown, setIncludeMarkdown] = useState(false);
  const diagram = useMemo(
    () =>
      showDiagram
        ? buildPlanDiagram(plan, changeset?.graph, { includeMarkdown })
        : null,
    [changeset?.graph, plan, showDiagram, includeMarkdown],
  );

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

      <IntentSection
        intent={plan.intent}
        changeset={changeset}
        onNavigate={onNavigate}
      />
      <MapSection
        map={plan.map}
        onNavigate={onNavigate}
        showDiagram={showDiagram}
        onToggleDiagram={() => setShowDiagram((value) => !value)}
        diagram={diagram}
        includeMarkdown={includeMarkdown}
        onToggleMarkdown={() => setIncludeMarkdown((value) => !value)}
      />
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
  changeset,
  onNavigate,
}: {
  intent: Claim[];
  changeset?: ChangeSet;
  onNavigate?: (ev: EvidenceRef) => void;
}) {
  // AI-supplied intent claims always take precedence — they describe the
  // change in a way the description usually doesn't.
  if (intent.length > 0) {
    return (
      <section className="plan__sec">
        <div className="plan__sec-h">What this change does</div>
        <ul className="plan__claims">
          {intent.map((c, i) => (
            <ClaimRow key={i} claim={c} onNavigate={onNavigate} />
          ))}
        </ul>
      </section>
    );
  }

  // Prefer the PR body (richer than the synthesised single-commit subject we
  // fall back to in worktree loads).
  const description = (changeset?.prSource?.body ?? changeset?.description ?? "").trim();

  const hasCommits = !!changeset?.commits && changeset.commits.length > 0;

  return (
    <section className="plan__sec">
      <div className="plan__sec-h">What this change does</div>
      {description && (
        <div className="plan__desc">
          <MarkdownView
            source={description}
            basePath=""
            imageAssets={changeset?.imageAssets}
          />
        </div>
      )}
      {changeset && hasCommits && (
        <CommitGroups changeset={changeset} onNavigate={onNavigate} />
      )}
      {changeset && !hasCommits && description && (
        <DescriptionFiles changeset={changeset} onNavigate={onNavigate} />
      )}
      {!description && !hasCommits && (
        <div className="plan__empty">No description available.</div>
      )}
    </section>
  );
}

function useGraphNodes(graph: ChangeSet["graph"]): Map<string, CodeGraphNode> {
  return useMemo(() => {
    const map = new Map<string, CodeGraphNode>();
    for (const n of graph?.nodes ?? []) map.set(n.path, n);
    return map;
  }, [graph]);
}

function FileLine({
  path,
  nodeByPath,
  onNavigate,
}: {
  path: string;
  nodeByPath: Map<string, CodeGraphNode>;
  onNavigate?: (ev: EvidenceRef) => void;
}) {
  const node = nodeByPath.get(path);
  const symbols = node?.symbols ?? [];
  return (
    <li className="plan__desc-file">
      <Reference ev={{ kind: "file", path }} onNavigate={onNavigate} />
      {node && <span className="plan__desc-file-role">{node.fileRole}</span>}
      {symbols.length > 0 && (
        <span className="plan__desc-file-defs">
          defines{" "}
          {symbols.map((s) => (
            <Reference
              key={s.name}
              ev={{ kind: "symbol", name: s.name, definedIn: path }}
              onNavigate={onNavigate}
            />
          ))}
        </span>
      )}
    </li>
  );
}

function DescriptionFiles({
  changeset,
  onNavigate,
}: {
  changeset: ChangeSet;
  onNavigate?: (ev: EvidenceRef) => void;
}) {
  const nodeByPath = useGraphNodes(changeset.graph);
  if (changeset.files.length === 0) return null;
  return (
    <ul className="plan__desc-files">
      {changeset.files.map((f) => (
        <FileLine
          key={f.id}
          path={f.path}
          nodeByPath={nodeByPath}
          onNavigate={onNavigate}
        />
      ))}
    </ul>
  );
}

function CommitGroups({
  changeset,
  onNavigate,
}: {
  changeset: ChangeSet;
  onNavigate?: (ev: EvidenceRef) => void;
}) {
  const nodeByPath = useGraphNodes(changeset.graph);
  const commits = changeset.commits ?? [];
  return (
    <ol className="plan__commits">
      {commits.map((c) => (
        <CommitGroup
          key={c.sha}
          commit={c}
          nodeByPath={nodeByPath}
          imageAssets={changeset.imageAssets}
          onNavigate={onNavigate}
        />
      ))}
    </ol>
  );
}

function CommitGroup({
  commit,
  nodeByPath,
  imageAssets,
  onNavigate,
}: {
  commit: ChangeSetCommit;
  nodeByPath: Map<string, CodeGraphNode>;
  imageAssets?: Record<string, string>;
  onNavigate?: (ev: EvidenceRef) => void;
}) {
  return (
    <li className="plan__commit">
      <div className="plan__commit-h">
        <code className="plan__commit-sha">{commit.shortSha}</code>
        <span className="plan__commit-subject">{commit.subject}</span>
      </div>
      {commit.body && (
        <div className="plan__commit-body">
          <MarkdownView
            source={commit.body}
            basePath=""
            imageAssets={imageAssets}
          />
        </div>
      )}
      {commit.files.length > 0 && (
        <ul className="plan__desc-files">
          {commit.files.map((p) => (
            <FileLine
              key={p}
              path={p}
              nodeByPath={nodeByPath}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </li>
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
  showDiagram,
  onToggleDiagram,
  diagram,
  includeMarkdown,
  onToggleMarkdown,
}: {
  map: StructureMap;
  onNavigate?: (ev: EvidenceRef) => void;
  showDiagram: boolean;
  onToggleDiagram: () => void;
  diagram: ReturnType<typeof buildPlanDiagram> | null;
  includeMarkdown: boolean;
  onToggleMarkdown: () => void;
}) {
  return (
    <section className="plan__sec">
      <div className="plan__sec-head">
        <div className="plan__sec-h">Map</div>
        <button
          type="button"
          className="plan__sec-btn"
          onClick={onToggleDiagram}
        >
          {showDiagram ? "hide diagram" : "generate diagram"}
        </button>
      </div>
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
      {diagram && (
        <PlanDiagramView
          diagram={diagram}
          includeMarkdown={includeMarkdown}
          onToggleMarkdown={onToggleMarkdown}
          onNavigate={onNavigate}
        />
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
