---
area: npm-client
status: active
title: Netlify proxy buffers upstream bodies in function memory
created: 2026-06-13
why: arrayBuffer() buffering fixed Netlify v2 response reliability but costs function memory proportional to body size
user_story: As a developer installing very large tarballs through rifty's deployed Netlify registry proxy, I want the proxy to stream bodies without holding them whole in function memory, but currently `handleNpmRegistryRequest` buffers via `await upstream.arrayBuffer()` — large packages could hit function memory/time limits.
sources: [ADR-0133, netlify/functions/npm-registry.mts]
code: [netlify/functions/npm-registry.mts]
---

## Context

`handleNpmRegistryRequest` buffers upstream bodies (`await upstream.arrayBuffer()`)
before re-wrapping the Response. Live evidence (2026-06-13, pr-25 preview):
38.8 MB vite metadata and latest tarball pass through — Netlify Functions v2
stream outward, so no response-size cap observed. Cost: function memory holds
the whole body; very large tarballs could hit function memory/time limits.

## Options or Next

- Keep buffering — current provisional choice (works, simple).
- Re-try pass-through streaming (`upstream.body`) and verify via the deploy
  smoke; revert if Netlify 502s return.

## Reversibility

REVERSIBLE — provisional; decision context in ADR-0133.
