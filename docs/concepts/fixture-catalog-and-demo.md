# Dev mode: fixture catalog and demo

## What it is
The repo’s fixture-driven surface for showing the product without driving the live app manually. This is a just an internal dev tool / concept rather than a user facing one.

## What it does
- Encodes canned `ReviewState` and `ReviewPlan` states as gallery fixtures.
- Powers `/gallery.html` as a screen catalog for design and review.
- Drives the demo reel from a simple frame script instead of hardcoding playback logic in the component.
- Gives the repo a repeatable way to inspect complex states like saturated AI notes, block comments, sign-off visuals, prompt flows, markdown preview, and desktop onboarding screens.
