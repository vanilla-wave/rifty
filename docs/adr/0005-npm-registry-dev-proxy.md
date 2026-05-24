# ADR 0005: Dev proxy for npm registry via Vite (D-004)

Status: Accepted
Date: 2026-05

Summary of decision D-004. In dev, `/npm-registry/*` proxies through Vite's `server.proxy` to `https://registry.npmjs.org`. Production strategy is deferred to Q4'.

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

- Base URL configured via `REGISTRY_BASE_URL` env or option, never hardcoded.
- In dev: `/npm-registry` (relative — Vite proxies it).
- In prod: the Q4' decision will populate this.
- In tests: a local mock-registry harness with deterministic fixtures.

## Why not a real proxy yet

M9 is months away (we're at M2). Cloudflare's free tier, Vercel functions, dedicated proxy — all change shape over a year. Defer the decision until we hit M9, when the constraints (latency, cache size, request volume) are real.
