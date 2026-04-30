# Prompt System

## What it is
The model for reusable review prompts and prompt execution context.

## What it does
- Defines prompts as ids, metadata, args, template body, and source.
- Merges shipped prompts with user prompts under one picker model.
- Supports lightweight templating and conditional blocks.
- Builds auto-fill context from the current changeset, file, and selection so prompts can run against live review context.

## Parts
### Prompt
The saved definition of a reusable prompt.

What it means:
- `id` is the stable key.
- `name` and `description` are picker-facing metadata.
- `args` describes the values the prompt expects.
- `body` is the template that gets rendered before sending.
- `source` says whether the prompt came from the shipped library or the user.

### PromptArg
The description of one input the prompt needs.

What it means:
- `name` is the template key.
- `required` tells the picker whether the run can proceed without a value.
- `auto` is a frontend hint for pre-filling from current review context.
- `description` explains the argument to the reviewer.

### AutoFillContext
The live review data the picker can pull from.

What it means:
- `changeset.title` gives prompt templates access to the current review title.
- `changeset.diff` gives access to the full serialized diff.
- `file.path` gives access to the current file path.
- `selection` gives access to the current hunk or selected block as diff text.

## Small example
```ts
const prompt: Prompt = {
  id: "security-review",
  name: "Security review",
  description: "Look for auth, input validation, and data handling risks.",
  args: [
    {
      name: "selection",
      required: true,
      auto: "selection",
      description: "Current hunk or selected block",
    },
    {
      name: "file",
      required: false,
      auto: "file",
      description: "Current file path",
    },
  ],
  body:
    "Review this code for security issues.\\n\\n" +
    "{{selection}}\\n" +
    "{{#file}}File: {{file}}{{/file}}",
  source: "library",
};

const context: AutoFillContext = {
  changeset: {
    title: "Add user preferences panel",
    diff: "diff --git a/src/utils/storage.ts b/src/utils/storage.ts ...",
  },
  file: {
    path: "src/utils/storage.ts",
  },
  selection:
    "File: src/utils/storage.ts\\n" +
    "@@ -20,4 +22,24 @@\\n" +
    "+export function loadPrefs(): Preferences | null {\\n" +
    "+  const raw = localStorage.getItem(PREFS_KEY);\\n" +
    "+}",
};
```

Read it like this:
- the `Prompt` defines the reusable template,
- the `args` define what values it wants,
- the `AutoFillContext` provides candidate values from the current review,
- the rendered result is the actual text that gets sent to the backend.
