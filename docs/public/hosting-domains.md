# Hosting domains

`rifty.dev` is split by responsibility:

| Host | Provider | Purpose |
|---|---|---|
| `rifty.dev` | Netlify (`rifty-landing`) | Static public landing page from `apps/landing` |
| `www.rifty.dev` | Netlify (`rifty-landing`) | Redirect to `https://rifty.dev/` |
| `play.rifty.dev` | Netlify (`rifty-playground`) | Cross-origin-isolated playground |
| `registry.rifty.dev` | Yandex Cloud CDN | npm registry proxy |
| `registry-origin.rifty.dev` | Yandex Cloud | CDN origin for npm registry proxy |
| `eddy.rifty.dev` | Yandex Cloud | Opt-in fast-install resolver (ADR-0182): POST resolve + GET-by-hash origin |
| `eddy-origin.rifty.dev` | Yandex Cloud | CDN origin host for eddy (ADR-0186) |
| `eddy-cdn.rifty.dev` | Yandex Cloud CDN | Edge-cached `GET /bundle/<closureHash>` (the edge refuses POST, so the resolver stays on the VM) |
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

The playground production build uses
`VITE_RIFTY_REGISTRY_URL=https://registry.rifty.dev/npm-registry`, so npm
metadata and tarballs go through Yandex Cloud CDN in front of the streaming
proxy recorded in ADR-0163. Local dev still uses the relative `/npm-registry`
Vite proxy.
