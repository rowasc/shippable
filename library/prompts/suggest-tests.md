---
name: Suggest tests for this hunk
description: Proposes concrete test cases (happy path, edge cases, regressions) for the selected hunk.
args:
  - name: hunk
    required: true
    auto: selection
  - name: language
    required: false
    description: Test framework / language hint (e.g. "vitest", "phpunit", "go test").
---
Propose concrete tests for the behavior introduced or modified by this hunk. Don't write a generic "what testing means" essay — produce a specific list of cases that would catch real regressions.

{{#language}}Use {{language}} conventions where relevant.{{/language}}

For each case, give:
- **Name**: a short test name in the right convention.
- **Setup**: any fixtures or inputs needed.
- **Assertion**: the exact behavior under test.

Cover:
1. The happy path (the change's main intent).
2. Edge cases the change touches (boundary values, empty/null, unicode, etc.).
3. Anything that would have *broken* before this change but should now pass.

Hunk:

```
{{hunk}}
```
