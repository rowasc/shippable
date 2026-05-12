import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type {
  ChangeSet,
  Claim,
  EntryPoint,
  EvidenceRef,
  ReviewPlan,
  StructureMap,
} from "../../web/src/types.ts";
import { buildStructureMap } from "../../web/src/plan.ts";
import { getCredential } from "./auth/store.ts";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";

const EvidenceRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("description") }),
  z.object({ kind: z.literal("file"), path: z.string() }),
  z.object({ kind: z.literal("hunk"), hunkId: z.string() }),
  z.object({
    kind: z.literal("symbol"),
    name: z.string(),
    definedIn: z.string(),
  }),
]);

const ClaimSchema = z.object({
  text: z.string(),
  evidence: z.array(EvidenceRefSchema),
});

const EntryPointSchema = z.object({
  fileId: z.string(),
  hunkId: z.string().optional(),
  reason: ClaimSchema,
});

const PlanResponseSchema = z.object({
  intent: z.array(ClaimSchema),
  // No max here — the model sometimes returns more than the prompt asks for.
  // We truncate to 3 in `assemblePlan` after evidence validation, so we keep
  // the best-validated 3 instead of blowing up the whole response.
  entryPoints: z.array(EntryPointSchema),
});

export type PlanResponse = z.infer<typeof PlanResponseSchema>;

const SYSTEM_PROMPT = `You are a senior code reviewer helping a human reviewer orient to a diff. Your job: given a ChangeSet (a structured diff) and a pre-computed StructureMap (files + symbol graph), produce:

1. **intent**: 2-5 claims describing what this ChangeSet does and why. Each claim must carry evidence pointing back into the diff.
2. **entryPoints**: up to 3 places the reviewer should start reading, ordered from best to worst starting point. Each entry point must have a fileId that exists in the ChangeSet.

## Evidence rules (non-negotiable)

Every claim you make MUST carry at least one evidence ref. Evidence refs come in four kinds:

- \`{ kind: "description" }\` — the ChangeSet.description text itself. Use when the claim restates the PR description.
- \`{ kind: "file", path: "<path>" }\` — cite a file by its path. The path MUST exactly match one in StructureMap.files.
- \`{ kind: "hunk", hunkId: "<id>" }\` — cite a specific hunk. The hunkId MUST match a hunk id from the provided diff.
- \`{ kind: "symbol", name: "<name>", definedIn: "<path>" }\` — cite a symbol. Both name and definedIn MUST match an entry in StructureMap.symbols.

Do NOT fabricate paths, hunk ids, or symbol names. If you cannot cite evidence, do not make the claim.

## Style for intent claims

- Start each with a concrete verb ("Adds", "Refactors", "Introduces", "Removes", "Wires up").
- One sentence. No hedging, no "this PR seems to".
- Prefer claims the reviewer couldn't trivially read off the file list (describe *what the change is doing*, not just *what files changed*).
- If the ChangeSet description is substantive, include a claim with \`{ kind: "description" }\` evidence that restates it.

## Style for entryPoints

- Prefer files that define symbols referenced by other files (roots of the diff's dependency graph).
- Test files are good secondary entry points — they describe intended behavior.
- Each entry point's reason must explain *why start here*, not just *what's here*.
- If a specific hunk is the best starting point (e.g., the main definition), include its hunkId.

You will be called via structured output (JSON schema). Return only the schema-conformant object. Do not include prose outside the structured output.`;

export async function generatePlan(cs: ChangeSet): Promise<ReviewPlan> {
  const map = buildStructureMap(cs);
  const userContent = buildUserMessage(cs, map);

  const client = new Anthropic({ apiKey: getCredential({ kind: "anthropic" }) });

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 4096,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userContent }],
    output_config: {
      format: zodOutputFormat(PlanResponseSchema),
    },
  });

  if (!response.parsed_output) {
    throw new Error(
      `Claude returned no parsed output (stop_reason: ${response.stop_reason})`,
    );
  }

  return assemblePlan(cs, map, response.parsed_output);
}

function buildUserMessage(cs: ChangeSet, map: StructureMap): string {
  const lines: string[] = [];
  lines.push(`# ChangeSet: ${cs.id}`);
  lines.push(`Title: ${cs.title}`);
  lines.push(`Branch: ${cs.branch} → ${cs.base}`);
  lines.push(`Author: @${cs.author}`);
  lines.push("");
  lines.push("## Description");
  lines.push(cs.description.trim() || "(no description)");
  lines.push("");
  lines.push("## StructureMap (pre-computed)");
  lines.push("```json");
  lines.push(JSON.stringify(map, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## Diff");
  for (const file of cs.files) {
    lines.push(`### ${file.path} (${file.status})`);
    for (const h of file.hunks) {
      lines.push(`#### hunk ${h.id} — ${h.header}`);
      lines.push("```");
      for (const l of h.lines) {
        const prefix = l.kind === "add" ? "+" : l.kind === "del" ? "-" : " ";
        lines.push(`${prefix}${l.text}`);
      }
      lines.push("```");
    }
  }
  return lines.join("\n");
}

function assemblePlan(
  cs: ChangeSet,
  map: StructureMap,
  parsed: PlanResponse,
): ReviewPlan {
  const fileIds = new Set(cs.files.map((f) => f.id));
  const filePaths = new Set(map.files.map((f) => f.path));
  const hunkIds = new Set<string>();
  for (const f of cs.files) {
    for (const h of f.hunks) hunkIds.add(h.id);
  }
  const symbols = new Map(
    map.symbols.map((s) => [`${s.name}@${s.definedIn}`, s]),
  );

  const resolveEvidence = (refs: EvidenceRef[]): EvidenceRef[] =>
    refs.filter((ref) => {
      switch (ref.kind) {
        case "description":
          return cs.description.trim().length > 0;
        case "file":
          return filePaths.has(ref.path);
        case "hunk":
          return hunkIds.has(ref.hunkId);
        case "symbol":
          return symbols.has(`${ref.name}@${ref.definedIn}`);
      }
    });

  const resolveClaim = (claim: Claim): Claim | null => {
    const evidence = resolveEvidence(claim.evidence);
    if (evidence.length === 0) return null;
    return { text: claim.text, evidence };
  };

  const intent = parsed.intent
    .map(resolveClaim)
    .filter((c): c is Claim => c !== null);

  const entryPoints: EntryPoint[] = [];
  for (const ep of parsed.entryPoints) {
    if (!fileIds.has(ep.fileId)) continue;
    const file = cs.files.find((f) => f.id === ep.fileId);
    if (!file) continue;
    let hunkId = ep.hunkId;
    if (hunkId && !file.hunks.some((h) => h.id === hunkId)) {
      hunkId = undefined;
    }
    const reason = resolveClaim(ep.reason);
    if (!reason) continue;
    entryPoints.push({ fileId: ep.fileId, hunkId, reason });
    if (entryPoints.length >= 3) break;
  }

  return {
    headline: cs.title,
    intent,
    map,
    entryPoints,
  };
}
