# Hosting the eddy fast-install resolver

`@riftydev/eddy` (ADR-0182) is the opt-in fast `npm install` resolver. It runs
rifty's OWN resolution server-side and returns one `EddyBundleV1` (lockfile +
compressed tarballs); the client pre-seeds its tarball cache + writes the
lockfile, then the existing lockfile fast path installs with zero packument
network — structurally ~100 cold round-trips collapse to 1 POST. Measured on a
real browser over warm h2: **1.70x** (standard 4284ms → eddy 2517ms). (The older
"~6x" is a Node/sandbox model, not a browser number — don't quote it at launch.)
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
`=` as-is): the client percent-encodes and S3 percent-decodes, so re-pointing
the CDN origin from the VM to the bucket needs no client/wire change.

**Deploy status (honest):** the committed `docker-compose.coi.yml` (and the
live rifty.dev VM it tracks) runs the MEMORY store — the S3 tier activates
only after this operator step. The access-key pair is a secret and is never
committed: fill the commented `EDDY_S3_*` placeholders in a LOCAL copy of the
COI compose and hand it to the VM via
`yc compute instance add-metadata --metadata-from-file docker-compose=<local-copy>`
(then restart). The committed file keeps placeholders only.

Yandex Object Storage recipe (operator, confirm-first — spend):

```bash
yc storage bucket create --name eddy-bundles --public-read
yc iam service-account create --name rifty-eddy-s3
yc storage bucket grant-access --name eddy-bundles \
  --role storage.uploader --service-account-name rifty-eddy-s3
yc iam access-key create --service-account-name rifty-eddy-s3   # prints key id + secret
```

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

CDN re-point: change the `eddy-cdn.rifty.dev` resource's origin from
`eddy-origin.rifty.dev` to the bucket
(`eddy-bundles.storage.yandexcloud.net`, host header pinned to the bucket
host). Keep 404/negative caching OFF at the edge — a miss must stay
`no-store` so the client's next POST can re-seed the very same hash. The
origin's own `GET /bundle/<hash>` keeps working either way (it reads the same
store), so the re-point can happen any time after the env lands.

**Browser-header prerequisite (do this BEFORE the re-point):** the eddy
ORIGIN sets `Access-Control-Allow-Origin: *` and
`Cross-Origin-Resource-Policy: cross-origin` on every response — today they
pass through the CDN unchanged (verified live 2026-07-04 with an
`Origin: https://play.rifty.dev` GET through `eddy-cdn`). The BUCKET sets
neither (the store PUTs only `Cache-Control` + `Content-Type`), so a
bucket-origin edge would serve bundles the browser refuses cross-origin.
Configure the CDN resource's static response headers (ACAO `*`, CORP
`cross-origin`) — or an equivalent bucket CORS rule — first, then smoke:

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
rides the cacheable GET on the next fresh profile. No operator work; a LEARNED exact-match pin wins over a
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
   (ingress `80/tcp` + `443/tcp`), and add the DNS records **first** (both A → the
   reserved IP, in the `rifty` zone — `docs/public/hosting-domains.md`):
   `eddy.rifty.dev` AND `eddy-origin.rifty.dev` (the COI Caddy serves both — the
   `-origin` host is the CDN origin, needed once you add the CDN tier below).
   **HTTP/3:** that group is TCP-only, so QUIC cannot negotiate — Caddy
   advertises h3 but browsers fall back to h2. The compose now publishes
   `443/udp`; to actually serve h3, also add an ingress `443/udp` rule (or a
   dedicated group). Until then every h3 claim/measurement is void
   (`docs/backlog/perf/eddy-http3-cold-validation.md`).

4. A COI compose = `deploy/yandex/eddy/docker-compose.yml` with eddy's `build:`
   replaced by `image: cr.yandex/$REG/eddy:<tag>` (the built+pushed tag; the
   committed `docker-compose.coi.yml` tracks the live one — Caddy unchanged).
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

6. Re-deploying a new image: push a NEW tag, update the `docker-compose`
   metadata key, restart:

   ```bash
   yc compute instance add-metadata --name rifty-eddy \
     --metadata-from-file docker-compose=deploy/yandex/eddy/docker-compose.coi.yml
   yc compute instance restart --name rifty-eddy
   ```

## CDN tier on rifty.dev (deployed 2026-07-01)

Live resources (ADR-0195; Yandex CDN provider `ourcdn` refuses POST at the
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
- Playground env (operator-set, OPT-IN — `netlify.toml` ships only
  `VITE_RIFTY_RESOLVER_URL` today): to route pinned GETs through the CDN, add
  `VITE_RIFTY_EDDY_BUNDLE_URL=https://eddy-cdn.rifty.dev`; to pin presets, add
  `VITE_RIFTY_EDDY_PINS` (JSON `template-id → closureHash`, each filled from a
  real `x-eddy-closure-hash` for that template — never a placeholder). Measured
  2026-07-02
  (median-of-5, same session): pin@origin == POST on a warm origin
  (~2.77s install→vite-ready vs standard 4.53s); pin@CDN traded ~+0.8s from a
  EU vantage (geo transit to the RU POP) for cold-restart immunity — the edge
  keeps serving pinned bundles when the origin's in-process LRU is empty
  (a cold-origin POST spiked to ~12.6s in the same session).

Tracked in `docs/backlog/distribution/eddy-package-and-deploy.md`.
