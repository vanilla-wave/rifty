# ADR 0005: Dev proxy for npm registry via Vite (D-004)

Status: Accepted
Date: 2026-05

D-004: in dev, `/npm-registry/*` proxies via Vite's `server.proxy` to `https://registry.npmjs.org`. Production strategy deferred to Q4'.

> TL;DR: dev `/npm-registry/*` proxies to `registry.npmjs.org` via Vite `server.proxy`; base URL from `REGISTRY_BASE_URL`, never hardcoded; prod deferred to M9

## Implementation

```ts
// apps/playground/vite.config.ts
server: {
  proxy: {
    '/npm-registry': {
      target: 'https://registry.npmjs.org',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/npm-registry/, ''),
    },
  },
}
```

## `npm-client` contract

- Base URL from `REGISTRY_BASE_URL` env/option — never hardcoded.
- Dev: `/npm-registry` (relative; Vite proxies).
- Prod: populated by the Q4' decision.
- Tests: local mock-registry harness with deterministic fixtures.

## Why not a real proxy yet

We're at M2; M9 is months out. Cloudflare free tier, Vercel functions, dedicated proxy — all will shift over a year. Defer until M9, when real constraints (latency, cache size, request volume) are known.
