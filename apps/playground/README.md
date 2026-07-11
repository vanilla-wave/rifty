# @riftydev/playground

The browser-side playground for rifty. SolidJS + Monaco + xterm.js.

## Layout

- `src/App.tsx` — the only Solid component the user sees. Splits into editor (left) + terminal (right).
- `src/glue/realVite.ts` — Vite asset/config adapter over the framework-free `@riftydev/workbench` owner.
- `src/workers/{real-vite,dev-server-child,kernel-worker,node-entry}-*.ts` — Vite URL wrappers; worker implementations live in `@riftydev/workbench`.
- `src/workers/worker-entry.ts` — module Worker entry; re-exports `@riftydev/runtime-js/worker`.
- `public/sw.js` — Service Worker (static for M0; rebuilds from `@riftydev/service-worker` arrive in M7).
- `vite.config.ts` — sets COOP/COEP headers required for cross-origin isolation (D-001) and proxies local-dev `/npm-registry` to npmjs.org (D-004). Production builds use `VITE_RIFTY_REGISTRY_URL=https://registry.rifty.dev/npm-registry`.

## Constraints

- `solid-js` is a hard-isolated dep: no other package in `packages/` may import it (D-002, enforced by Biome).
- No external CDN deps — everything must come from the same origin for `COEP: credentialless` to keep working.
