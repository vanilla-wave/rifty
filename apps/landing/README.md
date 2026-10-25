# rifty.dev landing

Hi-fi marketing page for `rifty.dev` ("Poster / Dark": 2px rule grid, Archivo Black display type,
one lime accent) + an embedded **interactive architecture explorer** (selected runtime topology
across five realm columns, hover adjacency, pin-to-inspect, 6 narrated scenarios).

Vanilla TS + Vite, static output. Separate Netlify origin from the playground (`play.rifty.dev`) so
its cross-origin-isolation, Service Worker, preview routing, and npm-registry proxy stay isolated
from the public page. COOP/COEP are deliberately NOT set here.

## Dev

```
VITE_RIFTY_SITE_URL=https://example.test/ \
VITE_RIFTY_REPOSITORY_URL=https://github.example/org/rifty \
VITE_RIFTY_SDK_DOCS_URL=https://docs.example/rifty-sdk \
VITE_RIFTY_PLAYGROUND_URL=https://play.example.test/ \
pnpm --filter @riftydev/landing dev       # vite dev server

VITE_RIFTY_SITE_URL=https://example.test/ \
VITE_RIFTY_REPOSITORY_URL=https://github.example/org/rifty \
VITE_RIFTY_SDK_DOCS_URL=https://docs.example/rifty-sdk \
VITE_RIFTY_PLAYGROUND_URL=https://play.example.test/ \
pnpm --filter @riftydev/landing build     # → dist/

pnpm --filter @riftydev/landing typecheck
```

The site requires four explicit deployment inputs: root-only `VITE_RIFTY_SITE_URL` owns
canonical/share/crawl URLs, `VITE_RIFTY_REPOSITORY_URL` owns repository exits,
`VITE_RIFTY_SDK_DOCS_URL` owns the complete SDK docs exit, and `VITE_RIFTY_PLAYGROUND_URL` owns demo
exits. The playground value accepts an absolute `http(s)` URL or an explicit root-relative mount;
the other three are absolute `http(s)` URLs. Missing or malformed config throws during build/dev
boot instead of shipping false links.

## Layout
- `index.html` — search/share metadata template + pre-JS critical shell.
- `vite.config.ts` — validates deployment URLs and emits configured robots/sitemap metadata.
- `src/main.ts` — atomically replaces that shell, then loads the explorer near the viewport.
- `src/landing-config.ts` — the configured exits, the labels derived from them (playground / site
  host, never a hardcoded domain), and the public release + milestone stamps.
- `src/sections/` — one builder per page section (nav, hero + marquee, what = terminal mock +
  capability grid, demos, arch + honest ceiling, packages, quickstart, cta-footer) plus the
  decorative `gauge`.
- `src/ceiling.ts` — the honest-ceiling rows (loud gaps); `src/public-snippets.ts` — the SDK code
  shown on the page, type-checked and Vite-built by `public-snippets.test.ts`.
- `src/explorer/` — the interactive architecture explorer. `data.ts` holds the live graph and
  scenario copy; layout descends from the frozen design handoff.
- `src/styles/` — design tokens (self-hosted Archivo Black / Inter / Roboto Mono) + base reset.
- `public/og-image.svg` is the share-card source; regenerate the PNG with
  `node tools/landing/render-og-image.mjs` after editing it.
- Visual baseline: `docs/landing/handoff/` (design input, frozen). Production facts live in `src/`.
