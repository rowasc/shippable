# Prompt Library

## What it is
The curated set of reusable prompts the app ships with for review work.

## What it does
- Gives the reviewer a starting set of common review tasks instead of making every prompt ad hoc.
- Defines a shared baseline for things like security review, test suggestions, hunk explanation, and PR summary generation.
- Lives alongside the user-prompt layer, but stays conceptually separate from it.
- Makes prompt execution feel like choosing from a toolbelt rather than writing one-off instructions every time.

## Small example
```md
---
name: Security review
description: Look for auth, input validation, and data handling risks.
args:
  - name: selection
    required: true
    auto: selection
---

Review this code for security issues:

{{selection}}
```

Read it like this:
- the prompt library is the shipped collection,
- each file is one reusable prompt definition,
- the picker turns those definitions into runnable prompt options in the UI.
