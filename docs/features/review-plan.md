# Review Plan

## What it is
The opening layer for a changeset. It answers "where should I start?" before the reviewer drops into the raw diff.

## What it does
- Shows a one-line headline for the change.
- Breaks the change into evidence-backed claims.
- Maps touched files, symbols, and test coverage.
- Suggests a few starting points instead of making the reviewer hunt.
- Lets the reviewer jump from a claim, file, hunk, or symbol straight into the diff.
- Keeps AI opt-in explicit with a `Send to Claude` action because the full diff leaves the machine.
- Falls back to a rule-based version if AI plan generation fails.

## Screenshot
![Review plan](./assets/review-plan-full.png)
