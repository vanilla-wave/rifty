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

## Layout
- `src/main.ts` — bootstraps the page: mounts sections, then the explorer.
- `src/sections/` — one builder per page section (nav, hero, what, arch, quickstart, cta-footer).
- `src/explorer/` — the interactive architecture explorer. `data.ts` holds the authoritative graph
  (nodes/edges/scenarios/positions), ported verbatim from the design handoff.
- `src/styles/` — design tokens + base reset.
- Design source of truth: `docs/landing/handoff/`.
