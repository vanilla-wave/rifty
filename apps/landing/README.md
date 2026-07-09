# rifty.dev landing

Hi-fi marketing page for `rifty.dev` + an embedded **interactive architecture explorer** (drag/pan/
zoom node graph, 6 real scenarios with BFS path animation, 3 views).

Vanilla TS + Vite, static output. Separate Netlify origin from the playground (`play.rifty.dev`) so
its cross-origin-isolation, Service Worker, preview routing, and npm-registry proxy stay isolated
from the public page. COOP/COEP are deliberately NOT set here.

## Dev

```
pnpm --filter @riftydev/landing dev       # vite dev server
pnpm --filter @riftydev/landing build     # → dist/
pnpm --filter @riftydev/landing typecheck
```

Playground links require `VITE_RIFTY_PLAYGROUND_URL`. It accepts an absolute `http(s)` URL or an
explicit root-relative mount. Self-hosters point it at their own playground deployment; the
official Netlify workflow injects `https://play.rifty.dev/` through that variable. Missing config
throws during page boot instead of producing a link back into the landing SPA.

## Layout
- `src/main.ts` — bootstraps the page: mounts sections, then the explorer.
- `src/sections/` — one builder per page section (nav, hero, demos, what, arch, quickstart,
  cta-footer).
- `src/explorer/` — the interactive architecture explorer. `data.ts` holds the authoritative graph
  (nodes/edges/scenarios/positions), ported verbatim from the design handoff.
- `src/styles/` — design tokens + base reset.
- Design source of truth: `docs/landing/handoff/`.
