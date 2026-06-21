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
- DNS: `registry.rifty.dev. 600 A 93.77.177.79` in zone `rifty`.

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

After VM recreation, update the `registry.rifty.dev` A record to the new public
IP and wait for Caddy to issue/renew TLS.
