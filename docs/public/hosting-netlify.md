# Hosting the rifty playground (Netlify)

The playground is a static SPA that **must** be served cross-origin-isolated
(COOP/COEP): `SharedArrayBuffer` + `Atomics.wait` back rifty's sync IPC
(D-001 / ADR-0002). GitHub Pages can't set those headers; Netlify can — hence
the target (ADR-0073).

Config: `netlify.toml` (repo root), `apps/playground/public/_headers`,
`apps/playground/public/_redirects` (both copied to `dist/` by Vite), and
`netlify/functions/npm-registry.mts`. Netlify build creates the static artifact
plus function metadata from the same config; deploys then publish that build
state so `/npm-registry/*` reaches the proxy function before the SPA fallback.

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

`.github/workflows/netlify.yml` owns continuous deploys:

- push to `main` → production deploy at `https://rifty-playground.netlify.app`;
- same-repo pull request → preview deploy with stable alias
  `https://pr-<number>--rifty-playground.netlify.app`;
- each Netlify deploy still has its own immutable deploy URL, and the workflow
  writes the latest preview URL back to the PR comment.
- both preview and production deploy jobs smoke-test `/npm-registry/vite` on
  the live URL so the production npm proxy cannot silently fall back to the SPA.

Required GitHub configuration:

- `NETLIFY_AUTH_TOKEN` repository secret;
- `NETLIFY_SITE_ID` repository variable or secret, only if overriding the
  checked-in `rifty-playground` site id;
- `NETLIFY_SITE_NAME` repository variable, only if overriding the
  checked-in `rifty-playground` site name used for PR alias comments.

Fork PRs do not run Netlify deploys because GitHub withholds repository
secrets from untrusted code.

### One-off from the CLI

```bash
pnpm dlx netlify@26.0.2 login          # once, to authenticate

root="$(pwd)"
site_id="${NETLIFY_SITE_ID:-441e5f8c-dbb4-43d7-8429-69983cc704c1}"
context="${NETLIFY_CONTEXT:-production}"
NETLIFY_SITE_ID="$site_id" pnpm dlx netlify@26.0.2 build --filter="@riftydev/playground" --context="$context"
pnpm dlx netlify@26.0.2 deploy --no-build --filter="@riftydev/playground" --dir="$root/apps/playground/dist" --site="$site_id" --prod
```

(`netlify deploy` without `--prod` creates a preview URL first — useful to
smoke-test before promoting.)

## Verify a deploy

On the live URL:

1. Console: `crossOriginIsolated` → `true`.
2. Terminal shows `[worker ready]` (not `[worker error] undefined`).
3. **Welcome** preset → prints `worker alive` + the circle-area line.
4. **Dev server** or **Real npm project** preset → live preview becomes `live`
   and renders in-frame.
5. Response headers on `/` include
   `Cross-Origin-Opener-Policy: same-origin` and
   `Cross-Origin-Embedder-Policy: credentialless`.

## Other hosts

Any host that can set custom response headers works the same way; the checked-in
production path is Netlify (`netlify.toml` plus `_headers`).
Plain GitHub Pages would need a `coi-serviceworker` shim to fake COOP/COEP
client-side.
