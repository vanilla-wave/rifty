# Hosting the eddy fast-install resolver

`@riftydev/eddy` (ADR-0182) is the opt-in fast `npm install` resolver. It runs
rifty's OWN resolution server-side and returns one `EddyBundleV1` (lockfile +
compressed tarballs); the client pre-seeds its tarball cache + writes the
lockfile, then the existing lockfile fast path installs with zero packument
network — structurally ~100 cold round-trips collapse to 1 POST. Measured on a
real browser over the production `auto` transport: **1.88x** (2026-07-07 run:
standard 5180ms → eddy 2761ms; both production origins negotiated h2;
`perf/benchmarks.json` tracks the current figure, which drifts with the standard
baseline's network variance). Forced h3 works on the direct origin hosts, but
`registry.rifty.dev` is CDN-fronted and the CDN hostname does not accept forced
QUIC, so the launch number is the production `auto` run. (The older "~6x" is a
Node/sandbox model, not a browser number — don't quote it at launch.)
It is **additive and opt-in** — standard install is untouched and is the
always-on fallback.

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

Or with local compose (`deploy/yandex/eddy/docker-compose.yml`):
`docker compose up --build`. That file uses `build:` and is NOT a COI input.
A Yandex Container-Optimized-Image VM PULLS images, so the rifty.dev path uses
the image-based `docker-compose.coi.yml`; the "Deploy to rifty.dev" section
below covers the build+push+metadata swap.

Once `@riftydev/eddy` is published to npm, a thin image is just
`FROM node:24-alpine` + `npm i -g @riftydev/eddy` + `CMD ["eddy"]`.

## Operator knobs (env)

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `8788` | Listen port |
| `REGISTRY_BASE_URL` | `https://registry.npmjs.org` | Upstream registry eddy resolves against (rifty.dev uses direct npmjs; the browser standard path still uses the CORS registry proxy) |
| `EDDY_TTL_SECONDS` | `1800` | Mutable-tier resolution TTL; `0` = always recompute (`--prefer-online` always) |
| `EDDY_PACKUMENT_TTL_SECONDS` | `300` | Process-wide packument cache (ADR-0194 §1; `300` = npmjs edge `max-age`); `0` = off |
| `EDDY_TARBALL_CACHE_MAX_BYTES` | `536870912` | Process-wide immutable tarball cache byte cap (ADR-0194 §2) |
| `EDDY_BUNDLE_MEMORY_MAX_BYTES` | `536870912` | Memory bundle-store byte cap (only without `EDDY_S3_*`) |
| `EDDY_S3_ENDPOINT` `EDDY_S3_BUCKET` `EDDY_S3_REGION` `EDDY_S3_ACCESS_KEY_ID` `EDDY_S3_SECRET_ACCESS_KEY` | unset | All-or-none: bundles live in an S3-compatible public-read bucket (ADR-0194 §4); partial config refuses to boot |

Caching (ADR-0182 §6, restructured by ADR-0194): the mutable
`dep-set → closure-hash` link honors the TTL and single-flights concurrent
identical requests; cold resolves share process-wide packument (TTL) and
immutable tarball caches, so an unseen-but-overlapping dep set refetches only
its novel packages. The immutable `closure-hash → bundle` tier is a
**BundleStore** — byte-bounded memory by default, an Object-Storage bucket
with `EDDY_S3_*` (below) — served content-addressed by
**`GET /bundle/<closure-hash>`** with
`Cache-Control: public, max-age=31536000, immutable`. Any CDN you front eddy
with — and every browser's HTTP cache — holds those bytes forever; a miss is a
404 `no-store`, and the client falls back to POST, which re-seeds the tier
(self-healing after a restart or eviction). Every bundle carries an as-of
stamp in `x-eddy-resolved-at` / `x-eddy-closure-hash` /
`x-eddy-npm-client-version` headers.

## Object-Storage bundle store (`EDDY_S3_*`, stateless origin)

With `EDDY_S3_*` set, a cold POST writes the bundle to the bucket BEFORE
linking it (durable-before-link, ADR-0194 §5) and the origin keeps only
reconstructible RAM caches — restarts/deploys lose nothing durable, extra
hosts need no shared disk, and the CDN can serve GET bytes straight from the
bucket. Object key = `bundle/<closure-hash>` with the hash RAW (base64 `/`
kept as an object-key slash; `+`/`=` percent-encoded in the signed request):
the client percent-encodes the hash and Yandex Object Storage public reads
still resolve `%2F` to the same raw-slash key, so re-pointing the CDN origin
from the VM to the bucket needs no client/wire change. This raw-slash signing
is required: Yandex rejects a SigV4 PUT whose canonical URI carries `%2F`.

**Deploy status (2026-07-07):** live rifty.dev is S3-backed. The committed
`docker-compose.coi.yml` intentionally keeps the `EDDY_S3_*` group commented;
the live VM metadata uses a LOCAL secret-bearing compose uploaded with
`yc compute instance add-metadata --metadata-from-file docker-compose=<local-copy>`.
The access-key pair is never committed and was not printed during deploy.
Verified live: POST returned `x-eddy-store-durable: 1`, public Object Storage
HEAD returned `200` with immutable cache-control, and after a VM cold restart
`GET /bundle/<known-hash>` still returned `200` with `durable=1`. Uploading the
checked-in placeholder compose still boots the memory store; use the local
secret-bearing copy for redeploys.

Yandex Object Storage recipe (operator, confirm-first — spend):

```bash
yc storage bucket create --name eddy-bundles --public-read
yc iam service-account create --name rifty-eddy-s3
SA_ID=$(yc iam service-account get --name rifty-eddy-s3 --format json | jq -r .id)
yc resource-manager folder add-access-binding <folder-id> \
  --role storage.uploader \
  --subject serviceAccount:$SA_ID
yc iam access-key create --service-account-name rifty-eddy-s3   # prints key id + secret
```

Prefer a bucket-scoped writer grant when the provider/CLI supports it. The
rifty.dev deploy uses the folder-scoped `storage.uploader` binding because this
`yc` build did not expose a working bucket-scoped grant path; the bucket itself
still has anonymous read enabled and list disabled.

VM env (compose): `EDDY_S3_ENDPOINT=https://storage.yandexcloud.net`,
`EDDY_S3_BUCKET=eddy-bundles`, `EDDY_S3_REGION=ru-central1`, plus the static
key pair. Only PUT is signed (hand-rolled SigV4, no SDK dep); GET/HEAD ride
the public-read bucket exactly like the CDN does.

Store contract the origin ENFORCES per put: after the signed PUT it proves the
UNSIGNED public read serves the exact bytes **with**
`Cache-Control: public, max-age=31536000, immutable` — a private bucket or a
store/proxy that strips that metadata fails the put loudly (POST degrades to
compute-and-serve, no link published). Every store op is bounded (30s per-op
deadline, 128 MiB body cap): a stalled bucket degrades, never parks the origin.

CDN re-point (live 2026-07-07): `eddy-cdn.rifty.dev` now uses the bucket
origin (`eddy-bundles.storage.yandexcloud.net`) with the Host header pinned to
that bucket host. Keep 404/negative caching OFF at the edge — a miss must stay
uncached so the client's next POST can re-seed the very same hash. The VM
origin's own `GET /bundle/<hash>` keeps working either way (it reads the same
store), so `eddy-origin.rifty.dev` remains a rollback/smoke host, not the live
CDN origin.

**Browser-header prerequisite (do this BEFORE any bucket re-point):** the
bucket sets neither CORS nor CORP (the store PUTs only `Cache-Control` +
`Content-Type`), so a bucket-origin edge would serve bundles the browser
refuses cross-origin unless the CDN adds headers. The live resource sets CORS
`*` plus static `Cross-Origin-Resource-Policy: cross-origin`; smoke:

```sh
curl -fsSI -H 'Origin: https://play.rifty.dev' \
  "https://eddy-cdn.rifty.dev/bundle/<known-hash>" \
  | grep -Ei 'access-control-allow-origin|cross-origin-resource-policy'
```

## Pinned presets (`VITE_RIFTY_EDDY_PINS`)

A playground deploy can pin a preset's resolved closure so its install rides
the cacheable GET (browser HTTP cache / CDN edge) instead of a POST
(ADR-0195 §5):

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

Beyond env pins, the playground LEARNS pins automatically (ADR-0194): after a
successful eddy install it persists `request-key → closure-hash`
(`/.rifty/eddy-learned-pins.json`, TTL 1800s = the server's mutable-tier
DEFAULT — the client does NOT track a deploy's custom `EDDY_TTL_SECONDS`; a
pin outliving the server link only costs a verified 404 → POST re-seed, never
a wrong install), so ANY repeat dep set — ad-hoc `npm install` included —
rides the cacheable GET within the same browser profile (the pins live in the
profile VFS; a truly fresh profile starts from the template env pins). No operator work; a LEARNED exact-match pin wins over a
template env pin (which only matches the pristine preset — env pins are the
fallback that seeds the first install of a set).

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
curl -fsS -D- -X POST http://localhost:8788 \
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
   yc container registry create --name rifty              # one-time (fresh cloud/folder)
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
   (ingress `80/tcp` + `443/tcp` + `443/udp`), and add the DNS records **first** (both A → the
   reserved IP, in the `rifty` zone — `docs/public/hosting-domains.md`):
   `eddy.rifty.dev` AND `eddy-origin.rifty.dev` (the COI Caddy serves both — the
   `-origin` host is the CDN origin, needed once you add the CDN tier below).
   **HTTP/3:** the group must include `443/udp` and the compose must publish
   `443:443/udp`; both are live for `eddy.rifty.dev`. The registry proxy origin
   can negotiate h3 too, but the production `registry.rifty.dev` CDN hostname did
   not accept forced QUIC in the 2026-07-07 browser probe, so production `auto`
   stayed h2.

4. A COI compose starts from `deploy/yandex/eddy/docker-compose.yml`, replaces
   eddy's `build:` with `image: cr.yandex/$REG/eddy:<tag>` (the built+pushed
   tag), and carries the deploy-only Caddy origin host
   `eddy-origin.rifty.dev`. The checked-in
   `deploy/yandex/eddy/docker-compose.coi.yml` is a placeholder-safe template;
   the live rifty.dev VM uses a local secret-bearing copy with `EDDY_S3_*`
   filled. For a stateless S3-backed origin, copy that file locally, fill the
   `EDDY_S3_*` group, and use the local copy below; uploading the checked-in
   placeholder file boots the memory store.
   Create the VM with that service account (mirrors the proxy specs):

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

6. Re-deploying a new image: push a NEW tag, update the COI compose's image
   tag, upload that compose as the `docker-compose` metadata key, restart. If
   the VM is S3-backed, reuse/update the same LOCAL secret-bearing compose from
   §Object-Storage; do not upload the checked-in placeholder template or eddy
   will boot the memory store.

   ```bash
   yc compute instance add-metadata --name rifty-eddy \
     --metadata-from-file docker-compose=<coi-compose>
   yc compute instance restart --name rifty-eddy
   ```

## CDN tier on rifty.dev (deployed 2026-07-01)

The resources below are LIVE from the 2026-07-01 CDN setup. The running image is
**v1.2** (tag `0.2.2`, redeployed 2026-07-05 — h3/UDP, eddy wire protocol v1.1,
non-blocking stamp; a live POST now emits `x-eddy-store-durable` + a
deep-canonical closure hash independent of the upstream registry URL). On
2026-07-07 the on-VM A/B measured direct npmjs faster than the CDN registry
proxy for eddy cold resolves, so live `REGISTRY_BASE_URL` is
`https://registry.npmjs.org`. S3 bundle store is live: POSTs publish durable
objects to the public-read `eddy-bundles` bucket before exposing a learnable
hash, and the CDN GET tier now reads from that bucket.

Live resources (ADR-0195; Yandex CDN provider `ourcdn` refuses POST at the
edge, hence the split-host shape):

- CDN resource `bc8rtmpmtax5opcdex6x`: cname `eddy-cdn.rifty.dev`, origin group
  `3357755679591203785` origin `eddy-bundles.storage.yandexcloud.net` (origin
  id `102946`, host header pinned to the bucket host), methods
  GET/HEAD/OPTIONS, CORS `*`, static CORP `cross-origin`,
  `cache-expiration-time-default 300` (origin `Cache-Control` wins — bundles are
  `immutable`), certificate `fpq8rrab6e3n0jo4jlts` (CM managed LE, DNS-01 via
  the `_acme-challenge.eddy-cdn` CNAME). Custom-cert propagation to the edge
  took ~10 min (the default `*.yccdn.cloud.yandex.net` cert answers until then).
- VM Caddy serves BOTH `eddy.rifty.dev` and `eddy-origin.rifty.dev`
  (`deploy/yandex/eddy/docker-compose.coi.yml`); `eddy-origin` is now the
  rollback/smoke origin for GET-by-hash, while live CDN misses fetch the bucket.
- Playground env (operator-set, OPT-IN — `netlify.toml` ships only
  `VITE_RIFTY_RESOLVER_URL` today): to route pinned GETs through the CDN, add
  `VITE_RIFTY_EDDY_BUNDLE_URL=https://eddy-cdn.rifty.dev`; to pin presets, add
  `VITE_RIFTY_EDDY_PINS` (JSON `template-id → closureHash`, each filled from a
  real `x-eddy-closure-hash` for that template — never a placeholder). Measured
  2026-07-02
  (median-of-5, same session): pin@origin == POST on a warm origin
  (~2.77s install→vite-ready vs standard 4.53s); pin@CDN traded ~+0.8s from a
  EU vantage (geo transit to the RU POP) for cold-restart immunity. Since
  2026-07-07 the CDN origin is the bucket, so a CDN miss no longer needs the VM
  to have the bundle in memory.

Tracked in `docs/backlog/distribution/eddy-package-and-deploy.md`.
