# Branch — Server

Express backend for the Branch spatial canvas app.

---

## BYOK (Bring Your Own Key) — Generate Endpoint

`POST /api/trees/:treeId/generate` acts as a BYOK proxy for image generation.

### How the key reaches the provider

The provider API key is read from a **request header only** — never from the
request body, query string, environment, or any persistent store.

| Priority | Header | Format |
|----------|--------|--------|
| 1 (preferred) | `x-provider-key` | `x-provider-key: fal-abc123...` |
| 2 (fallback) | `Authorization` | `Authorization: Bearer fal-abc123...` |

The key is held in memory for the lifetime of a single request and passed
directly into `createAdapter(provider, { apiKey })`. It is **never**:

- written to any log output
- included in any response body or error message
- persisted to the database (not in the node record, not in settings)
- cached or reused across requests

### Provider selection

| Priority | Source |
|----------|--------|
| 1 | `x-provider` request header (per-request override) |
| 2 | `GENERATION_PROVIDER` environment variable |
| 3 | `"mock"` (hard fallback) |

### Provider key requirements

| Provider | Key required? | Notes |
|----------|--------------|-------|
| `mock` (default) | No | Works with no key; used for local dev and tests |
| `flux-fal` | Yes | Requires a [fal.ai](https://fal.ai) API key |

### Error responses

| Situation | HTTP status | Body |
|-----------|-------------|------|
| Key missing for a key-requiring provider | **400** | `{ "error": "API key required" }` |
| Bad / expired key (provider auth failure) | **502** | `{ "error": "generation failed", ... }` |
| Generation failure (other) | **502** | `{ "error": "generation failed", "cost": { "credits": 0 } }` |
| Unknown `x-provider` value | **400** | `{ "error": "Unknown generation provider: ..." }` |

### Local development (.env)

Copy `.env.example` to `.env` and fill in your values:

```
GENERATION_PROVIDER=flux-fal
FAL_KEY=fal-your-key-here
```

`npm start` (and `npm run dev`) load `.env` automatically via `dotenv/config`
in `src/server/index.js`. Tests do **not** load `.env` — they are fully
isolated from local environment files.

When running with `GENERATION_PROVIDER=flux-fal` locally, you can pass the key
via `FAL_KEY` (server-side, from `.env`) or per-request via the
`x-provider-key` header (client BYOK mode). The per-request header always
takes precedence over any server-side default.

> ⚠️ **Production:** do NOT set `FAL_KEY` in the deployed environment. It is a
> local-dev convenience only — in production the server must rely solely on the
> per-request `x-provider-key` header so each user pays with their own key
> (true BYOK). A server-side `FAL_KEY` would let keyless requests bill *your*
> account.

### Example request (curl)

```bash
curl -X POST http://localhost:3000/api/trees/1/generate \
  -H "Content-Type: application/json" \
  -H "x-provider-key: fal-your-key-here" \
  -H "x-provider: flux-fal" \
  -d '{ "branchId": "1", "prompt": "a mountain at sunrise" }'
```

---

## Generation adapter interface

All provider calls go through `src/server/generation/adapter.js` (the
`GenerationAdapter` base class). Route handlers must never call a provider SDK
directly. See `src/server/generation/README.md` for adapter authoring details.

## Budget / velocity tracking

Cost per generation is logged and a rolling spend-rate window is maintained in
`src/server/generation/` (see Milestone 2 budget service). The budget service
is independent of which provider is active.
