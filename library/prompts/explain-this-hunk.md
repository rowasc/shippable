---
name: Explain this hunk
description: Plain-English explanation of what the selected code does and why it might exist.
args:
  - name: selection
    required: true
    auto: selection
---
Explain what this code does, in plain English, as if to a teammate who is unfamiliar with the file. Cover:

1. What changed (one or two sentences).
2. Why this change might exist, based on the diff context — flag uncertainty explicitly.
3. Anything subtle a reviewer might miss.

Keep it short. No rephrasing the diff line by line.

Selection:

```
{{selection}}
```
