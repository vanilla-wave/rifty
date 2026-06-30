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

Immutable artifacts are served `Cache-Control: public, max-age=31536000,
immutable` so a CDN holds the content-addressed bundle; the mutable
`dep-set → closure-hash` lookup honors the TTL. Every bundle carries an as-of
stamp in `x-eddy-resolved-at` / `x-eddy-closure-hash` /
`x-eddy-npm-client-version` headers.

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

A **confirm-first**, operator-owned step (spend + shared infra). The compose
mirrors the ADR-0163 registry proxy (`docs/public/hosting-yandex.md`): a Caddy
sidecar terminates TLS for `eddy.rifty.dev` and reverse-proxies to eddy on
`:8788`. eddy sets the cross-origin headers (CORS + CORP) itself, so they pass
through. Caddy's automatic TLS does an ACME HTTP-01 challenge on first boot, so
the DNS record + open ports must exist **first**:

1. Reserve a static IP and a security group with ingress `80/tcp` + `443/tcp`.
2. Add `eddy.rifty.dev. A <reserved-ip>` in the `rifty` zone
   (`docs/public/hosting-domains.md`).
3. Create the VM from the compose (mirrors the proxy create shape):

   ```bash
   yc compute instance create-with-container rifty-eddy \
     --zone ru-central1-a \
     --cores 2 --core-fraction 20 --memory 1G \
     --create-boot-disk type=network-hdd,size=16G,auto-delete=true \
     --network-interface subnet-name=default-ru-central1-a,nat-address=<reserved-ip>,security-group-ids=<eddy-sg-id> \
     --docker-compose-file deploy/yandex/eddy/docker-compose.yml
   ```

4. Once TLS is issued, smoke `https://eddy.rifty.dev` (the POST form above over
   https). Then set `VITE_RIFTY_RESOLVER_URL=https://eddy.rifty.dev` in the
   playground prod build (`netlify.toml`) so from-scratch presets resolve via
   eddy.

Tracked in `docs/backlog/distribution/eddy-package-and-deploy.md`.
