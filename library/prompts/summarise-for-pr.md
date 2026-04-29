---
name: Summarise diff for PR description
description: Generates a concise PR description from the changeset — title-line, summary, optional test plan.
args:
  - name: title
    required: false
    auto: changeset.title
  - name: diff
    required: true
    auto: changeset.diff
---
Write a PR description for the following diff. Aim for what a senior engineer would actually want to read:

- A one-line title (under ~70 chars){{#title}} — current draft is "{{title}}", refine if needed{{/title}}.
- A 2–4 line **Summary** that says *why* this change exists, not just what it does.
- A short **Notes** section only if there are non-obvious decisions, follow-ups, or things a reviewer should know.

No filler. No "this PR" preamble. No emoji.

Diff:

```
{{diff}}
```
