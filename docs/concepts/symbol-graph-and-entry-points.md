# Symbol Graph And Entry Points

## What it is
The repo’s way of turning changed code into a lightweight dependency map.

## What it does
- Collects symbol definitions and references from hunks.
- Builds a structure map that connects defining files to referencing files.
- Uses that graph to pick starting points for review.
- Falls back to tests or biggest-change files when the symbol graph is weak.
