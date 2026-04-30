# Review Plan Model

## What it is
The structured answer to "what is this change doing and where should I start?"

## What it does
- Normalizes a plan into `headline`, `intent`, `map`, and `entryPoints`.
- Makes the plan a first-class data model instead of ad hoc UI text.
- Supports both rule-based and AI-generated plans behind the same contract.
- Keeps the plan navigable because entry points and evidence resolve back into the diff.

## Parts
### headline
The top-line label for the change.

What it means:
- Usually the changeset title verbatim.
- Gives the reviewer fast orientation before they read any claims.
- Is not meant to explain the whole change by itself.

### intent
The list of claims about what the change is doing.

What it means:
- This is the semantic summary layer.
- Each item is a sentence like "Adds a preferences panel backed by localStorage."
- Every claim carries evidence, so it is not allowed to be free-floating prose.
- This is where rule-based and AI-generated reasoning both surface their summary.

### map
The structural view of the diff.

What it means:
- Lists the files in the change, including status and line counts.
- Lists symbols defined in the diff and where else in the diff they are referenced.
- Gives the reviewer a quick dependency picture instead of making them infer it from raw hunks.
- Acts as the bridge between "what changed" and "where should I read first."

### entryPoints
The suggested places to begin reading.

What it means:
- A short ranked list of starting points, not a full walkthrough.
- Each entry points at a file, and sometimes a specific hunk.
- Each entry also includes a reason claim with evidence.
- The goal is to reduce thrash at the start of a review, especially when the diff spans multiple files.

## Small example
```ts
const plan: ReviewPlan = {
  headline: "Add user preferences panel",
  intent: [
    {
      text: "Adds a preferences panel backed by localStorage.",
      evidence: [{ kind: "description" }],
    },
    {
      text: "Defines loadPrefs and savePrefs in src/utils/storage.ts.",
      evidence: [
        { kind: "symbol", name: "loadPrefs", definedIn: "src/utils/storage.ts" },
        { kind: "symbol", name: "savePrefs", definedIn: "src/utils/storage.ts" },
      ],
    },
  ],
  map: {
    files: [
      {
        fileId: "cs-42/src/utils/storage.ts",
        path: "src/utils/storage.ts",
        status: "modified",
        added: 15,
        removed: 0,
        isTest: false,
      },
    ],
    symbols: [
      {
        name: "loadPrefs",
        definedIn: "src/utils/storage.ts",
        referencedIn: ["src/components/PreferencesPanel.tsx"],
      },
    ],
  },
  entryPoints: [
    {
      fileId: "cs-42/src/utils/storage.ts",
      reason: {
        text: "Defines loadPrefs, referenced by src/components/PreferencesPanel.tsx.",
        evidence: [
          { kind: "symbol", name: "loadPrefs", definedIn: "src/utils/storage.ts" },
        ],
      },
    },
  ],
};
```

Read it like this:
- `headline` says what review you are in.
- `intent` says what the change claims to do.
- `map` says what code is involved.
- `entryPoints` says where to start reading first.
