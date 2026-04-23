import type {
  ChangeSet,
  Claim,
  EntryPoint,
  ReviewPlan,
  StructureMap,
  StructureMapFile,
  StructureMapSymbol,
} from "./types";

const TEST_PATH = /(^|\/)__tests__\/|\.test\.[tj]sx?$|\.spec\.[tj]sx?$/;

function isTestPath(path: string): boolean {
  return TEST_PATH.test(path);
}

function countChanges(cs: ChangeSet, fileId: string): { added: number; removed: number } {
  const file = cs.files.find((f) => f.id === fileId);
  if (!file) return { added: 0, removed: 0 };
  let added = 0;
  let removed = 0;
  for (const h of file.hunks) {
    for (const l of h.lines) {
      if (l.kind === "add") added++;
      else if (l.kind === "del") removed++;
    }
  }
  return { added, removed };
}

export function buildStructureMap(cs: ChangeSet): StructureMap {
  const files: StructureMapFile[] = cs.files.map((f) => {
    const { added, removed } = countChanges(cs, f.id);
    return {
      fileId: f.id,
      path: f.path,
      status: f.status,
      added,
      removed,
      isTest: isTestPath(f.path),
    };
  });

  // symbol name → { definedIn, referencedIn set }
  const defs = new Map<string, { definedIn: string; referencedIn: Set<string> }>();

  for (const f of cs.files) {
    for (const h of f.hunks) {
      for (const name of h.definesSymbols ?? []) {
        // First definition wins. Re-definitions across hunks are rare; if it
        // matters later, extend this to a list.
        if (!defs.has(name)) {
          defs.set(name, { definedIn: f.path, referencedIn: new Set() });
        }
      }
    }
  }

  for (const f of cs.files) {
    for (const h of f.hunks) {
      for (const name of h.referencesSymbols ?? []) {
        const entry = defs.get(name);
        if (!entry) continue; // symbol defined outside this ChangeSet; ignore
        if (entry.definedIn !== f.path) entry.referencedIn.add(f.path);
      }
    }
  }

  // Backfill: fixtures and parsed diffs often declare `definesSymbols` without
  // matching `referencesSymbols`. Scan added/context text for the names we
  // know about so the graph isn't missing edges. `del` lines describe the
  // pre-diff state and are skipped.
  for (const f of cs.files) {
    for (const [name, entry] of defs) {
      if (entry.definedIn === f.path) continue;
      if (entry.referencedIn.has(f.path)) continue;
      const re = new RegExp(`\\b${escapeRegExp(name)}\\b`);
      outer: for (const h of f.hunks) {
        for (const l of h.lines) {
          if (l.kind === "del") continue;
          if (re.test(l.text)) {
            entry.referencedIn.add(f.path);
            break outer;
          }
        }
      }
    }
  }

  const symbols: StructureMapSymbol[] = [];
  for (const [name, { definedIn, referencedIn }] of defs) {
    symbols.push({ name, definedIn, referencedIn: [...referencedIn].sort() });
  }
  symbols.sort((a, b) => a.name.localeCompare(b.name));

  return { files, symbols };
}

export function summarizeIntentRule(cs: ChangeSet, map: StructureMap): Claim[] {
  const claims: Claim[] = [];

  const desc = cs.description.trim();
  if (desc.length > 0) {
    claims.push({ text: desc, evidence: [{ kind: "description" }] });
  }

  // Group "defines X" claims by defining file, so we don't spam one claim per symbol.
  const byFile = new Map<string, StructureMapSymbol[]>();
  for (const s of map.symbols) {
    const bucket = byFile.get(s.definedIn) ?? [];
    bucket.push(s);
    byFile.set(s.definedIn, bucket);
  }

  for (const [definedIn, syms] of byFile) {
    const names = syms.map((s) => s.name);
    const hunkId = findDefiningHunk(cs, definedIn, names);
    claims.push({
      text: `Defines ${formatList(names)} in ${definedIn}.`,
      evidence: [
        ...syms.map((s) => ({
          kind: "symbol" as const,
          name: s.name,
          definedIn: s.definedIn,
        })),
        ...(hunkId ? [{ kind: "hunk" as const, hunkId }] : []),
      ],
    });
  }

  const tests = map.files.filter((f) => f.isTest);
  if (tests.length > 0) {
    claims.push({
      text:
        tests.length === 1
          ? `Includes one test file: ${tests[0].path}.`
          : `Includes ${tests.length} test files.`,
      evidence: tests.map((t) => ({ kind: "file" as const, path: t.path })),
    });
  }

  return claims;
}

function findDefiningHunk(
  cs: ChangeSet,
  path: string,
  symbols: string[],
): string | undefined {
  const file = cs.files.find((f) => f.path === path);
  if (!file) return undefined;
  for (const h of file.hunks) {
    const defined = h.definesSymbols ?? [];
    if (symbols.some((n) => defined.includes(n))) return h.id;
  }
  return undefined;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * Pick up to 3 entry points. A file is a good entry point if it's a "root" —
 * i.e. nothing else in the diff that it depends on (via referenced symbols
 * defined elsewhere in the ChangeSet). Test files are offered as an alternate
 * entry when present, because they describe intent without requiring impl
 * context first.
 */
export function pickEntryPoints(cs: ChangeSet, map: StructureMap): EntryPoint[] {
  const picked: EntryPoint[] = [];

  const defByFile = new Map<string, StructureMapSymbol[]>();
  for (const s of map.symbols) {
    const bucket = defByFile.get(s.definedIn) ?? [];
    bucket.push(s);
    defByFile.set(s.definedIn, bucket);
  }

  const dependsOnOther = (path: string): boolean =>
    map.symbols.some(
      (s) => s.definedIn !== path && s.referencedIn.includes(path),
    );

  // 1. Source roots: defines symbols referenced by ≥1 other file, and itself
  //    depends on nothing in the diff.
  const rootCandidates = [...defByFile.entries()]
    .filter(([path, syms]) => {
      if (dependsOnOther(path)) return false;
      return syms.some((s) => s.referencedIn.length > 0);
    })
    .sort((a, b) => {
      // Prefer roots whose symbols are referenced by more files.
      const fanoutA = a[1].reduce((n, s) => n + s.referencedIn.length, 0);
      const fanoutB = b[1].reduce((n, s) => n + s.referencedIn.length, 0);
      return fanoutB - fanoutA;
    });

  for (const [path, syms] of rootCandidates) {
    if (picked.length >= 3) break;
    const file = cs.files.find((f) => f.path === path)!;
    const hunkId = findDefiningHunk(cs, path, syms.map((s) => s.name));
    const referencers = [
      ...new Set(syms.flatMap((s) => s.referencedIn)),
    ].sort();
    picked.push({
      fileId: file.id,
      hunkId,
      reason: {
        text: `Defines ${formatList(syms.map((s) => s.name))}, referenced by ${formatList(referencers)}.`,
        evidence: [
          ...syms.map((s) => ({
            kind: "symbol" as const,
            name: s.name,
            definedIn: s.definedIn,
          })),
          ...(hunkId ? [{ kind: "hunk" as const, hunkId }] : []),
        ],
      },
    });
  }

  // 2. Test files as alternates.
  for (const f of map.files) {
    if (picked.length >= 3) break;
    if (!f.isTest) continue;
    if (picked.some((p) => p.fileId === f.fileId)) continue;
    picked.push({
      fileId: f.fileId,
      reason: {
        text: `Test file — shows intended behavior of the new code.`,
        evidence: [{ kind: "file", path: f.path }],
      },
    });
  }

  // 3. Fallback: if we found nothing (no symbol graph, no tests), offer the
  //    single file with the most additions so the reviewer has *somewhere* to
  //    land. Only do this when there's genuinely no better signal.
  if (picked.length === 0 && map.files.length > 0) {
    const largest = [...map.files].sort((a, b) => b.added - a.added)[0];
    picked.push({
      fileId: largest.fileId,
      reason: {
        text: `Largest change by added lines (${largest.added}).`,
        evidence: [{ kind: "file", path: largest.path }],
      },
    });
  }

  return picked;
}

export function planReview(cs: ChangeSet): ReviewPlan {
  const map = buildStructureMap(cs);
  return {
    headline: cs.title,
    intent: summarizeIntentRule(cs, map),
    map,
    entryPoints: pickEntryPoints(cs, map),
  };
}
