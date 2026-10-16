# Hosting domains

`rifty.dev` is split by responsibility:

| Host | Provider | Purpose |
|---|---|---|
| `rifty.dev` | Netlify (`rifty-landing`) | Static public landing page from `apps/landing` |
| `www.rifty.dev` | Netlify (`rifty-landing`) | Redirect to `https://rifty.dev/` |
| `play.rifty.dev` | Netlify (`rifty-playground`) | Cross-origin-isolated playground |
| `registry.rifty.dev` | Yandex Cloud CDN — **out of service since 2026-10** | Former npm registry proxy (ADR-0163); production now uses the same-origin `play.rifty.dev/npm-registry/*` Netlify rewrite (ADR-0528) |
| `registry-origin.rifty.dev` | Yandex Cloud — **out of service** | CDN origin for the former npm registry proxy |
| `eddy.rifty.dev` | Yandex Cloud — **out of service** | Opt-in fast-install resolver (ADR-0182): POST resolve + GET-by-hash origin; OFF in the production build (ADR-0528) |
| `eddy-origin.rifty.dev` | Yandex Cloud — **out of service** | VM GET fallback / rollback origin for eddy (ADR-0195) |
| `eddy-cdn.rifty.dev` | Yandex Cloud CDN — **out of service** | Edge-cached `GET /bundle/<closureHash>` from the Object Storage bucket (the edge refuses POST, so the resolver stays on the VM) |
| `api.rifty.dev` | Yandex Cloud (planned) | Future project APIs |

Yandex Cloud DNS owns the public zone. Netlify remains the deploy surface for
the landing and playground so GitHub-triggered deploys stay in one flow. The
landing must not inherit the playground's COOP/COEP headers or Service Worker:
those belong only to `play.rifty.dev`.

Expected DNS records:

```text
rifty.dev.       ANAME  apex-loadbalancer.netlify.com.
www.rifty.dev.   CNAME  rifty-landing.netlify.app.
play.rifty.dev.  CNAME  rifty-playground.netlify.app.
registry.rifty.dev.  CNAME  409f80b3d8827091.topology.gslb.yccdn.ru.
registry-origin.rifty.dev.  A  93.77.177.79
eddy.rifty.dev.  A  89.169.128.66
eddy-origin.rifty.dev.  A  89.169.128.66
eddy-cdn.rifty.dev.  CNAME  409f80b3d8827091.topology.gslb.yccdn.ru.
_acme-challenge.eddy-cdn.rifty.dev.  CNAME  fpq8rrab6e3n0jo4jlts.cm.yandexcloud.net.
```

The `*.topology.gslb.yccdn.ru` target is SHARED across this folder's CDN
resources — the provider routes at the edge by the request's Host header
(`registry.rifty.dev` → the registry resource, `eddy-cdn.rifty.dev` → the eddy
resource), so both CNAMEs intentionally point at the same value. Verified live
2026-07-07: `eddy-cdn.rifty.dev/bundle/<known-hash>` fetches the
`eddy-bundles` bucket origin and serves `Cache-Control: public, max-age=31536000,
immutable`, `Access-Control-Allow-Origin: *`, and
`Cross-Origin-Resource-Policy: cross-origin`. When adding a CDN resource, take
the target from `yc cdn resource get <id>` — do not assume it is per-resource.

The playground production build keeps the relative `/npm-registry` registry
base: `play.rifty.dev/npm-registry/*` is a Netlify 200 rewrite to
`registry.npmjs.org` (ADR-0528), the same shape as the local Vite proxy. The
Yandex-hosted rows above describe infrastructure that stopped answering on
2026-10-13 (origin TCP timeout, CDN edge 504/403); DNS records are kept so the
hosts can be restored without a routing change
(`docs/backlog/distribution/restore-dedicated-registry-proxy-and-eddy.md`).
