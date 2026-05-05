# Server API Boundary

## What it is
The small HTTP contract between the frontend and the AI-backed backend.

## What it does
- Exposes plan generation, streaming review, prompt listing, library refresh, worktree ingest, and health endpoints.
- Keeps the frontend on a stable API instead of reaching into provider SDKs directly.
- Centralizes origin checks, rate limiting, and provider-key requirements.
- Is a hard dependency. The web app probes `/api/health` at boot and refuses to load without it; worktree ingest, the prompt library, and the AI plan all live here.
