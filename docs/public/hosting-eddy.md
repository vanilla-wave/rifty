# Hosting the eddy fast-install resolver

`@riftydev/eddy` (ADR-0182) is the opt-in fast `npm install` resolver. It runs
rifty's OWN resolution server-side and returns one `EddyBundleV1` (lockfile +
compressed tarballs); the client pre-seeds its tarball cache + writes the
lockfile, then the existing lockfile fast path installs with zero packument
network (~6x cold). It is **additive and opt-in** — standard install is
untouched and is the always-on fallback.

Run your own eddy to keep the speedup a property of the **open, self-hostable**
stack. Trust boundary: mirror-grade — see the eddy section of
`docs/public/trust-model.md`.

## Run it (Docker, from source)

The image builds from the monorepo source (no npm publish required). From the
repo root:

```sh
docker build -f deploy/yandex/eddy/Dockerfile -t riftydev-eddy .
docker run -p 8788:8788 \
  -e REGISTRY_BASE_URL=https://registry.npmjs.org \
  -e EDDY_TTL_SECONDS=1800 \
  riftydev-eddy
```

Or with compose (`deploy/yandex/eddy/docker-compose.yml`), mirroring the
ADR-0163 registry-proxy deploy: hand the compose file to a Yandex
Container-Optimized-Image VM exactly as `docs/public/hosting-yandex.md` does for
the proxy.

Once `@riftydev/eddy` is published to npm, a thin image is just
`FROM node:24-alpine` + `npm i -g @riftydev/eddy` + `CMD ["eddy"]`.

## Operator knobs (env)

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `8788` | Listen port |
| `REGISTRY_BASE_URL` | `https://registry.npmjs.org` | Upstream registry eddy resolves against (point at your registry proxy to share one trust boundary, ADR-0163) |
| `EDDY_TTL_SECONDS` | `1800` | Mutable-tier resolution TTL; `0` = always recompute (`--prefer-online` always) |

Caching is two layers (ADR-0182 §6 + ADR-0186): eddy's **in-process LRU**
(bounded, per-process; a repeat identical dep-set is served from memory, the
mutable `dep-set → closure-hash` lookup honors the TTL), plus the
content-addressed **`GET /bundle/<closure-hash>`** route serving the immutable
tier with `Cache-Control: public, max-age=31536000, immutable`. Any CDN you
front eddy with — and every browser's HTTP cache — holds those bytes forever; a
miss is a 404 `no-store`, and the client falls back to POST, which re-seeds the
tier (self-healing after a restart or LRU eviction). Every bundle carries an
as-of stamp in `x-eddy-resolved-at` / `x-eddy-closure-hash` /
`x-eddy-npm-client-version` headers.

## Pinned presets (`VITE_RIFTY_EDDY_PINS`)

A playground deploy can pin a preset's resolved closure so its install rides
the cacheable GET (browser HTTP cache / CDN edge) instead of a POST
(ADR-0186 §5):

1. POST the preset's dep-set once and read the `x-eddy-closure-hash` response
   header (the smoke command below prints headers with `-D-`).
2. Set `VITE_RIFTY_EDDY_PINS='{"<template-id>":"<closure-hash>"}'` (JSON map) in
   the playground build env, next to `VITE_RIFTY_RESOLVER_URL`.
3. CDN-fronted GETs need a SEPARATE hostname: edges (Yandex CDN included)
   refuse the POST resolve, so the CDN cname must not replace the resolver
   DNS. Set `VITE_RIFTY_EDDY_BUNDLE_URL=https://<cdn-hostname>` — pinned GETs
   ride it, the POST resolve (and every fallback) stays on
   `VITE_RIFTY_RESOLVER_URL`. rifty.dev shape: `eddy.rifty.dev` A → VM
   (origin), `eddy-origin.rifty.dev` A → VM (the CDN's origin host),
   `eddy-cdn.rifty.dev` CNAME → the CDN provider endpoint.

Re-pin whenever a template's dependencies change, or on a deliberate cadence to
pick up new transitive releases. A stale pin never rots into a wrong install —
the client verifies coverage + integrity and degrades to POST; unpinned presets
simply keep POSTing.

## Cold-spike knobs

A multi-second first-request spike is scale-to-zero / cache-miss, not the
steady path: keep at least one instance warm (`min-instances ≥ 1` or an
always-on VM), set `EDDY_TTL_SECONDS` to your staleness budget so warm hits
never recompute, and front the GET route with a CDN so instance restarts don't
lose hot immutable-tier entries. More server CPU only speeds a cache-miss
`resolveBundle`, never a warm hit.

## Wire a client to it

Set the resolver URL via env-config (D-004; default OFF, never baked):
`@riftydev/sdk` / `@riftydev/npm-client` `install({ resolverUrl })`, or the
playground's `VITE_RIFTY_RESOLVER_URL`. The client verifies every tarball's
bytes against the bundle integrity (non-disableable) and auto-falls-back to the
standard verifying install on any failure.

## Smoke

POST a dep-set and confirm a tar stream comes back:

```sh
curl -fsS -X POST http://localhost:8788 \
  -H 'content-type: application/json' \
  -d '{"dependencies":{"debug":"^4.4.1"}}' \
  -o /tmp/bundle.tar && tar tf /tmp/bundle.tar
```

You should see `eddy-bundle.json`, `package-lock.json`, and `tarballs/*.tgz`.

## Deploy to rifty.dev

A **confirm-first**, operator-owned step (spend + shared infra). Unlike the
ADR-0163 proxy (a public `caddy` image), eddy ships a CUSTOM image, and a Yandex
Container-Optimized-Image VM **pulls** images — it does NOT build — so the image
is built + pushed to a registry and the COI compose references it by `image:`
(not the `build:` the local `docker compose up` self-host uses). eddy sets the
cross-origin headers itself; a Caddy sidecar only terminates TLS for
`eddy.rifty.dev`. Caddy's ACME HTTP-01 runs on first boot, so DNS + ports exist
first.

1. Build + push the image to Yandex Container Registry. The VM is amd64 —
   from an Apple-Silicon laptop you MUST cross-build (`docker buildx
   --platform linux/amd64`; a plain `docker build` produces arm64 and the
   container crash-loops with exec-format-error behind a Caddy 502). The
   Dockerfile's build stage is `--platform=$BUILDPLATFORM` (the artifact is
   platform-independent JS), so the cross-build runs at native speed. Bump
   the TAG on every deploy — the COI VM does not re-pull an existing tag:

   ```bash
   yc container registry configure-docker                 # once
   REG=$(yc container registry get --name rifty --format json | jq -r .id)
   docker buildx build --platform linux/amd64 \
     -f deploy/yandex/eddy/Dockerfile \
     -t cr.yandex/$REG/eddy:<new-tag> --push .
   ```

2. A service account the VM uses to pull (COI uses the VM's SA):

   ```bash
   yc iam service-account create --name rifty-eddy-vm
   yc container registry add-access-binding --name rifty \
     --role container-registry.images.puller \
     --service-account-name rifty-eddy-vm
   ```

3. Reserve a static IP, reuse the proxy's `rifty-registry-proxy` security group
   (ingress `80/tcp` + `443/tcp`), and add the DNS record **first**:
   `eddy.rifty.dev. A <reserved-ip>` in the `rifty` zone
   (`docs/public/hosting-domains.md`).

4. A COI compose = `deploy/yandex/eddy/docker-compose.yml` with eddy's `build:`
   replaced by `image: cr.yandex/$REG/eddy:0.1.0` (Caddy unchanged). Create the
   VM with that service account (mirrors the proxy specs):

   ```bash
   yc compute instance create-with-container rifty-eddy \
     --zone ru-central1-a --cores 2 --core-fraction 20 --memory 1G \
     --create-boot-disk type=network-hdd,size=16G,auto-delete=true \
     --service-account-name rifty-eddy-vm \
     --network-interface subnet-name=default-ru-central1-a,nat-address=<reserved-ip>,security-group-ids=<sg-id> \
     --docker-compose-file <coi-compose>
   ```

5. Once TLS is issued, smoke `https://eddy.rifty.dev` (the POST form above over
   https). Then set `VITE_RIFTY_RESOLVER_URL=https://eddy.rifty.dev` in the
   playground prod build (`netlify.toml`) so from-scratch presets resolve via
   eddy.

6. Re-deploying a new image: push a NEW tag, update the `docker-compose`
   metadata key, restart:

   ```bash
   yc compute instance add-metadata --name rifty-eddy \
     --metadata-from-file docker-compose=deploy/yandex/eddy/docker-compose.coi.yml
   yc compute instance restart --name rifty-eddy
   ```

## CDN tier on rifty.dev (deployed 2026-07-01)

Live resources (ADR-0186; Yandex CDN provider `ourcdn` refuses POST at the
edge, hence the split-host shape):

- CDN resource `bc8rtmpmtax5opcdex6x`: cname `eddy-cdn.rifty.dev`, origin
  `https://eddy-origin.rifty.dev` (host header pinned to the origin name),
  methods GET/HEAD/OPTIONS, `cache-expiration-time-default 300`
  (origin `Cache-Control` wins — bundles are `immutable`), certificate
  `fpq8rrab6e3n0jo4jlts` (CM managed LE, DNS-01 via the
  `_acme-challenge.eddy-cdn` CNAME). Custom-cert propagation to the edge took
  ~10 min (the default `*.yccdn.cloud.yandex.net` cert answers until then).
- VM Caddy serves BOTH `eddy.rifty.dev` and `eddy-origin.rifty.dev`
  (`deploy/yandex/eddy/docker-compose.coi.yml`).
- Playground env: `VITE_RIFTY_EDDY_BUNDLE_URL=https://eddy-cdn.rifty.dev` +
  `VITE_RIFTY_EDDY_PINS` (template-id → hash). Measured 2026-07-02
  (median-of-5, same session): pin@origin == POST on a warm origin
  (~2.77s install→vite-ready vs standard 4.53s); pin@CDN traded ~+0.8s from a
  EU vantage (geo transit to the RU POP) for cold-restart immunity — the edge
  keeps serving pinned bundles when the origin's in-process LRU is empty
  (a cold-origin POST spiked to ~12.6s in the same session).

Tracked in `docs/backlog/distribution/eddy-package-and-deploy.md`.
