# Server API Boundary

## What it is
The small HTTP contract between the frontend and the AI-backed backend.

## What it does
- Exposes plan generation, streaming review, prompt listing, library refresh, and health endpoints.
- Keeps the frontend on a stable API instead of reaching into provider SDKs directly.
- Centralizes origin checks, rate limiting, and provider-key requirements.
- Makes the backend optional because the frontend can fall back to rule-based planning when the server is absent.
