# Hosting the rifty playground (Netlify)

The playground is a static SPA that **must** be served cross-origin-isolated
(COOP/COEP): `SharedArrayBuffer` + `Atomics.wait` back rifty's sync IPC
(D-001 / ADR-0002). GitHub Pages can't set those headers; Netlify can — hence
the target (ADR-0073).

Config: `netlify.toml` (repo root) and `apps/playground/public/_headers`
(copied to `dist/_headers` by Vite). Either alone sets the headers; both are
kept so `dist/` is self-describing.

## What gets built

```
pnpm install --frozen-lockfile && pnpm build      # build command
apps/playground/dist                              # publish dir
```

`pnpm build` builds all libraries then the playground (`vite build`). Output
includes the bundled worker chunks (`worker-entry-*.js`,
`kernel-worker-entry-*.js`), which exist only because the worker entries are
imported with `?worker&url` (ADR-0073). A deployed REPL crashing with
`[worker error] undefined` means that bundling regressed.

## Deploy

Manual (outward-facing). Two options:

### A. Connect the Git repo (continuous deploys, recommended)

1. Netlify → **Add new site → Import an existing project** → pick
   `github.com/vanilla-wave/rifty`.
2. Netlify reads `netlify.toml` automatically — leave detected build
   command / publish dir.
3. Deploy. Every push to `main` redeploys.

### B. One-off from the CLI

```bash
npx netlify-cli login                  # once, to authenticate

pnpm build                             # from the repo root
npx netlify-cli deploy --dir=apps/playground/dist --prod
```

(`netlify deploy` without `--prod` creates a preview URL first — useful to
smoke-test before promoting.)

## Verify a deploy

On the live URL:

1. Console: `crossOriginIsolated` → `true`.
2. Terminal shows `[worker ready]` (not `[worker error] undefined`).
3. **Welcome** preset → prints `worker alive` + the circle-area line.
4. Response headers on `/` include
   `Cross-Origin-Opener-Policy: same-origin` and
   `Cross-Origin-Embedder-Policy: credentialless`.

## Known limitation

The in-page **live preview** (Dev server / Real Vite presets) shows
`unavailable`: the SW aborts sub-frame preview navigations under cross-origin
isolation — pre-existing, tracked in `docs/backlog/service-worker/preview-subframe-nav-owner-routing.md` (Q-2026-06-03-308).
The four REPL presets work fully; a blank preview is not a deploy failure.

## Other hosts

Any host that can set custom response headers works the same way: Vercel
(`vercel.json`, already present), Cloudflare Pages / Netlify (`_headers`).
Plain GitHub Pages would need a `coi-serviceworker` shim to fake COOP/COEP
client-side.
