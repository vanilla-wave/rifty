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
  `80/tcp` + `443/tcp`, egress all.
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
