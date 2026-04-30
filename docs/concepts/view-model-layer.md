# View Model Layer

## What it is
The repo’s separation between domain state and React presenters.

## What it does
- Uses pure builder functions to turn state slices into render-ready view models.
- Keeps DOM and React concerns out of the transformation layer.
- Makes presenters simpler because they render precomputed labels, glyphs, counts, and statuses instead of deriving them live.
- Gives the codebase a cleaner seam for fixtures, gallery states, and tests later if the project grows up.
