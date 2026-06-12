---
area: npm-client
status: active
title: Netlify proxy buffers upstream bodies in function memory
created: 2026-06-13
why: arrayBuffer() buffering fixed Netlify v2 response reliability but costs function memory proportional to body size
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
