# Theme Token System

## What it is
The shared token model for app chrome and syntax styling.

## What it does
- Defines named theme packs as CSS variable maps.
- Applies both UI colors and syntax colors from the same theme definition.
- Persists the selected theme in localStorage.
- Keeps theme switching cheap because the app swaps variables at the root instead of branching component styles everywhere.
- Base surfaces use `bg` / `bg-1`, with progressively raised chrome on `bg-2` and `bg-3`. Components should not invent undeclared surface tokens.
