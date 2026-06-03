# Hosting the rifty playground (Netlify)

The playground is a static SPA, but it **must** be served cross-origin-isolated
(COOP/COEP) — `SharedArrayBuffer` + `Atomics.wait` back rifty's sync IPC
(D-001 / ADR-0002). Plain GitHub Pages can't set those headers; Netlify can,
which is why it's the target (ADR-0073).

Config lives in `netlify.toml` (repo root) and `apps/playground/public/_headers`
(copied to `dist/_headers` by Vite). Either alone provides the headers; both are
kept so the built `dist/` is self-describing.

## What gets built

```
pnpm install --frozen-lockfile && pnpm build      # build command
apps/playground/dist                              # publish dir
```

`pnpm build` builds every library then the playground (`vite build`). The output
includes the bundled runtime/kernel **worker chunks** (`worker-entry-*.js`,
`kernel-worker-entry-*.js`) — these only exist because the worker entries are
imported with `?worker&url` (ADR-0073). If you ever see the live REPL crash with
`[worker error] undefined` on a deployed build, that bundling regressed.

## Deploy

Deployment is **manual** (outward-facing). Two options:

### A. Connect the Git repo (recommended for continuous deploys)

1. Netlify → **Add new site → Import an existing project** → pick
   `github.com/vanilla-wave/rifty`.
2. Netlify reads `netlify.toml` automatically — leave build command / publish
   dir as detected (they come from the file).
3. Deploy. Every push to `main` redeploys.

### B. One-off from the CLI

```bash
# once, to authenticate:
npx netlify-cli login

# from the repo root:
pnpm build
npx netlify-cli deploy --dir=apps/playground/dist --prod
```

(`netlify deploy` without `--prod` creates a preview URL first — useful to
smoke-test before promoting.)

## Verify a deploy

After it's live, on the deployed URL:

1. DevTools console: `crossOriginIsolated` → `true`.
2. The terminal shows `[worker ready]` (not `[worker error] undefined`).
3. Click the **Welcome** preset → `worker alive` + the circle-area line print.
4. Response headers on `/` include
   `Cross-Origin-Opener-Policy: same-origin` and
   `Cross-Origin-Embedder-Policy: credentialless`.

## Known limitation

The in-page **live preview** (Dev server / Real Vite presets) shows a
`unavailable` status because the SW aborts sub-frame preview navigations under
cross-origin isolation — pre-existing, tracked in `OPEN_QUESTIONS.md`
(Q-2026-06-03-308). The four REPL presets work fully. Don't treat a blank
preview as a deploy failure.

## Other hosts

Any host that can set custom response headers works the same way: Vercel
(`vercel.json`, already present), Cloudflare Pages / Netlify (`_headers`). Plain
GitHub Pages would need a `coi-serviceworker` shim to fake COOP/COEP client-side.
