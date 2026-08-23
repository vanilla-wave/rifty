# Hosting on Yandex Cloud

Yandex Cloud owns DNS for `rifty.dev` and hosts services that are not just
static Netlify deploys.

## npm registry proxy

`registry.rifty.dev` is a streaming Caddy reverse proxy on Yandex Cloud Compute
(ADR-0163). Source config:

```text
deploy/yandex/npm-registry/Caddyfile
deploy/yandex/npm-registry/docker-compose.yml
tools/registry/smoke-npm-registry.mjs
```

The proxy accepts only `GET`, `HEAD`, and `OPTIONS`, strips the
`/npm-registry` prefix, streams to `https://registry.npmjs.org`, and sets
`Access-Control-Allow-Origin: *` plus
`Cross-Origin-Resource-Policy: cross-origin`.

Current resources:

- VM: `rifty-npm-registry-proxy` (`fhmiuan6ka2pitkt3ait`), `ru-central1-a`.
- Public IPv4: `93.77.177.79` (`rifty-registry-proxy-ip`,
  `e9b0ph17evqtt1lnvl17`).
- Security group: `rifty-registry-proxy` (`enp064boa7v26die0el1`), ingress
  `80/tcp` + `443/tcp` + `443/udp`, egress all.
- DNS: `registry.rifty.dev. 600 CNAME
  409f80b3d8827091.topology.gslb.yccdn.ru.` in zone `rifty`.
- CDN origin DNS: `registry-origin.rifty.dev. 600 A 93.77.177.79` in zone
  `rifty`; keep this pointed at the VM so the CDN origin never loops back to
  itself.
- CDN resource: `bc8rt27zbc2ycfeghqjn` (`registry.rifty.dev`, provider CNAME
  `409f80b3d8827091.topology.gslb.yccdn.ru`, origin
  `registry-origin.rifty.dev`, cert `fpql3mp7n30ddn15vtd3`). Before rollback or
  provider changes, verify an edge probe serves the `registry.rifty.dev` cert,
  not the default `*.yccdn.cloud.yandex.net` cert.

One-off create/update shape:

```bash
yc compute instance create-with-container rifty-npm-registry-proxy \
  --zone ru-central1-a \
  --cores 2 \
  --core-fraction 20 \
  --memory 1G \
  --create-boot-disk type=network-hdd,size=16G,auto-delete=true \
  --network-interface subnet-name=default-ru-central1-a,nat-address=<reserved-ip>,security-group-ids=<http-https-sg-id> \
  --docker-compose-file deploy/yandex/npm-registry/docker-compose.yml

node tools/registry/smoke-npm-registry.mjs https://registry.rifty.dev
```

After VM recreation, update only the `registry-origin.rifty.dev` A record to the
new public IP and wait for Caddy to issue/renew origin TLS. Keep
`registry.rifty.dev` pointed at the CDN CNAME unless rolling CDN back to the VM.

## eddy fast-install resolver

`eddy.rifty.dev` is the opt-in fast-install resolver (ADR-0182) on a
Container-Optimized-Image VM with a Caddy TLS sidecar. Unlike the proxy (a
public `caddy` image), eddy ships a CUSTOM image, so it is built + pushed to a
Yandex Container Registry and the COI compose references it by `image:` (COI
pulls, it can't build the `build:` context). Source:

```text
deploy/yandex/eddy/Dockerfile
deploy/yandex/eddy/docker-compose.yml       # build: — local self-host only
deploy/yandex/eddy/docker-compose.coi.yml   # image: — the rifty.dev VM
tools/eddy/smoke-eddy.mjs
```

Current resources (folder `b1g7flke7mgq94dklalu`):

- Registry: `rifty` (`crpo6kvhb4o7gv41g0s4`); live image
  `cr.yandex/crpo6kvhb4o7gv41g0s4/eddy:0.2.4` (linux/amd64, digest
  `sha256:2660a9122c79ce759cf30b4791281ed5ae2e6fba7e07a87c43aec466048623ce`).
- VM: `rifty-eddy`, `ru-central1-a`; reuses the `rifty-registry-proxy` security
  group (`enp064boa7v26die0el1`, ingress 80/443 tcp + 443 udp).
- Public IPv4: `89.169.128.66` (`rifty-eddy-ip`, `e9bbnd8mhba48o4vq5kn`).
- VM service account: `rifty-eddy-vm` (`ajeknkij3plg4dua0g1u`) with
  `container-registry.images.puller` on the registry and folder-level
  `monium.metrics.writer` (COI pulls + Unified Agent writes metrics via VM SA).
- DNS: `eddy.rifty.dev. 600 A 89.169.128.66` in zone `rifty`.
- Upstream: `REGISTRY_BASE_URL=https://registry.npmjs.org` (flipped
  2026-07-07 after on-VM A/B; the browser standard path still uses
  `registry.rifty.dev/npm-registry`, ADR-0163).
- Bundle store: Object Storage bucket `eddy-bundles`, anonymous read enabled,
  list disabled; writer service account `rifty-eddy-s3`
  (`ajejj189d3hr9q33aud3`) has folder-scoped `storage.uploader`. The live VM
  carries the `EDDY_S3_*` access key only in secret-bearing metadata.
- CDN GET tier: resource `bc8rtmpmtax5opcdex6x` (`eddy-cdn.rifty.dev`,
  certificate `fpq8rrab6e3n0jo4jlts`) uses origin group `3357755679591203785`,
  origin `102946` = `eddy-bundles.storage.yandexcloud.net`, host header pinned
  to the bucket, methods GET/HEAD/OPTIONS, CORS `*`, and static CORP
  `cross-origin`.
- Memory envelope: 64 MiB serialized packuments, 128 MiB tarballs, one
  admitted heavy POST flight; overload is retryable 503 (ADR-0363).
- Guest monitoring: pinned `cr.yandex/yc/unified-agent` sidecar digest
  `sha256:ab285672…b59e5`; advanced memory/kernel/I/O metrics use
  `service=custom`, label `host=fhme5dumk6bouckm931s`.

Build + push the image (amd64), then create the VM:

```bash
REG=crpo6kvhb4o7gv41g0s4
docker build --platform linux/amd64 -f deploy/yandex/eddy/Dockerfile -t cr.yandex/$REG/eddy:<new-tag> .
yc container registry configure-docker && docker push cr.yandex/$REG/eddy:<new-tag>
yc compute instance create-with-container rifty-eddy \
  --zone ru-central1-a --cores 2 --core-fraction 20 --memory 1G \
  --create-boot-disk type=network-hdd,size=16G,auto-delete=true \
  --service-account-id ajeknkij3plg4dua0g1u \
  --network-interface subnet-name=default-ru-central1-a,nat-address=89.169.128.66,security-group-ids=enp064boa7v26die0el1 \
  --docker-compose-file <local-secret-bearing-coi-compose>
node tools/eddy/smoke-eddy.mjs https://eddy.rifty.dev
```

Same image tag → **recreate** the VM to force a fresh pull (COI won't re-pull a
cached tag). DNS + ingress 80/443 must exist before first boot so Caddy's ACME
HTTP-01 succeeds.
