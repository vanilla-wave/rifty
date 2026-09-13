# @riftydev/playground

The browser-side playground for rifty. SolidJS + Monaco + xterm.js.

## Layout

- `src/App.tsx` — the only Solid component the user sees. Splits into editor (left) + terminal (right).
- `src/adapters/useRuntime.ts` — thin Solid adapter over `@riftydev/runtime-js`'s framework-agnostic controller.
- `src/workers/worker-entry.ts` — module Worker entry; re-exports `@riftydev/runtime-js/worker`.
- `public/sw.js` — Service Worker (static for M0; rebuilds from `@riftydev/service-worker` arrive in M7).
- `vite.config.ts` — sets COOP/COEP headers required for cross-origin isolation (D-001) and proxies local-dev `/npm-registry` to npmjs.org (D-004). Production builds use `VITE_RIFTY_REGISTRY_URL=https://registry.rifty.dev/npm-registry`.

## Constraints

- `solid-js` is a hard-isolated dep: no other package in `packages/` may import it (D-002, enforced by Biome).
- No external CDN deps — everything must come from the same origin for `COEP: credentialless` to keep working.

## Chat

Open a starter, then **+chat**. Set an OpenAI-compatible Base URL and model in
Settings. API key is optional and memory-only; only endpoint/model survive reload.
The agent edits the current project's files and uses a visible **Agent** terminal.
Stop retains results; Reset, Close, project switch and Apply settings start fresh
conversations without reverting files. Export session downloads the trace/diff.

For an endpoint blocked by browser CORS, run dev with
`RIFTY_AI_PROXY_TARGET=http://localhost:<port> pnpm dev` and set Base URL to
`/ai-proxy/v1`. This proxy exists only in the development server.
