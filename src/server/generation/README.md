# Generation Adapter Layer

Provider-agnostic interface for image (and future: text, audio) generation.
The generation layer is designed so the canvas and budget systems never need
to know which provider is active.

---

## Files

| File | Purpose |
|------|---------|
| `types.js` | JSDoc typedefs — `GenerationRequest`, `GenerationResult`, `GenerationCost`. No runtime code. |
| `adapter.js` | `GenerationAdapter` abstract base class + `GenerationError`. |
| `registry.js` | `registerAdapter` / `createAdapter` / `registeredAdapters`. |
| `adapters/mock.js` | `MockGenerationAdapter` — deterministic, zero-network, for tests and local dev. |
| `index.js` | Re-exports the public surface. Import from here, not from sub-files. |

---

## GenerationResult shape

Every adapter method (`submit`, `poll`, `generate`) resolves to a
`GenerationResult`:

```js
{
  jobId:    string,          // Provider-assigned or adapter-generated job ID
  status:   'pending'        // Accepted, not yet started
           |'running'        // Actively generating
           |'succeeded'      // Done — assetUrl is non-null
           |'failed',        // Terminal failure — error is non-null
  assetUrl: string | null,   // Public URL of the generated asset (null until succeeded)
  provider: string,          // Registry name of the adapter ("mock", "flux-fal", …)
  model:    string,          // Specific model/version used
  cost: {
    credits:  number,        // Provider-native units (>= 0). REQUIRED — feeds budget tracking.
    currency: string,        // Optional label ("FAL_CREDITS", "USD", …)
  },
  raw:   unknown,            // Unmodified provider response (for debugging / auditing)
  error: GenerationError | null,  // Non-null only on status === 'failed'
}
```

### Why `cost` is required

The `cost.credits` field is part of the contract (not optional) because the
token-budget and velocity-tracking service consumes it on every generation
result.  Adapters for free tiers or local mocks must still populate it (with
`credits: 0`).

---

## How the async queue uses submit + poll

The queue calls `submit(request)` to kick off a job and stores the returned
`jobId`.  A worker later calls `poll(jobId)` until `status` is `'succeeded'`
or `'failed'`, then writes the result (including `cost`) to the database.

Callers that do not need queue visibility (e.g. simple synchronous routes,
tests) can call `generate(request)` which wraps the polling loop internally.

```js
// Queue worker pattern
const { jobId } = await adapter.submit(request);
// … store jobId, come back later …
const result = await adapter.poll(jobId); // repeat until terminal

// Simple caller pattern
const result = await adapter.generate(request);
```

---

## Selecting a provider

Set `GENERATION_PROVIDER` before starting the server:

```sh
GENERATION_PROVIDER=flux-fal node src/server/index.js
```

Unset (or omitted) defaults to `"mock"`.

---

## Adding a new provider (e.g. Flux via fal.ai)

1. Create `src/server/generation/adapters/flux-fal.js`:

```js
import { GenerationAdapter, GenerationError } from '../adapter.js';

export class FluxFalAdapter extends GenerationAdapter {
  constructor(config) {
    super();
    this._apiKey = config.apiKey ?? process.env.FAL_API_KEY;
  }

  async submit(request) {
    // POST to fal.ai queue endpoint, return { jobId, status: 'pending' }
  }

  async poll(jobId) {
    // GET fal.ai status endpoint, map response to GenerationResult
    // Map provider errors to GenerationError
  }
}
```

2. Register the adapter (e.g. at the bottom of the same file, or in an init
   module loaded at server startup):

```js
import { registerAdapter } from '../registry.js';
registerAdapter('flux-fal', (config) => new FluxFalAdapter(config));
```

3. Set `GENERATION_PROVIDER=flux-fal` in your environment.

4. Done.  The canvas, queue, and budget service require no changes.

---

## Error handling

All provider-specific errors must be caught inside the adapter and rethrown as
`GenerationError`:

```js
import { GenerationError } from '../adapter.js';

throw new GenerationError('Rate limit exceeded', {
  provider: 'flux-fal',
  code: 'RATE_LIMITED',
  raw: providerResponse,  // original payload preserved for debugging
});
```

The queue and budget service only deal with `GenerationError`, so provider
error shapes are fully encapsulated inside each adapter.
