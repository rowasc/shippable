# Evidence Model

## What it is
The repo’s contract for attaching claims to source.

## What it does
- Represents evidence as `description`, `file`, `hunk`, or `symbol` references.
- Forces claims to point back to concrete source locations.
- Keeps review-plan output inspectable instead of letting summaries float free of the diff.
- Gives the UI a consistent way to turn a claim into navigation.
