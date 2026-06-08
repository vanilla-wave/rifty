---
area: toolchain-build
status: parked
title: Source @riftydev/io tests into pnpm compat:generate (Buffer matrix hand-maintained)
created: 2026-06-08
why: docs/public/compat/buffer.md is hand-maintained because compat:generate can't yet read @riftydev/io test results — an unfinished tooling gap
sources: [docs/public/compat/buffer.md header, A-033]
---
## Context
`docs/public/compat/buffer.md` header: "Hand-maintained until `pnpm compat:generate` learns to source `@riftydev/io` tests." The Buffer matrix (method/encoding/test inventory) drifts from the real `packages/io/src/buffer.test.ts` (33 cases) + parity cases because the generator doesn't ingest `@riftydev/io` package-level tests — only conformance/integration results feed `compat:generate` today. Same shape as the broader A-033 obligation (matrix populated only at milestone DoD).
## Options / Next
Next: teach `compat:generate` to source `@riftydev/io` (and other package-level) test runs so the Buffer matrix auto-regenerates instead of hand-edits. Until then the matrix stays hand-maintained and drift-prone. Lower priority than shipped surfaces; parked until the matrix drift actually bites or a milestone closer needs it. Pairs with browser-compat-matrix (service-worker) as a compat-tooling cluster.
## Reversibility
REVERSIBLE. Tooling-only (`tools/` + the generator script), no package public API, no new external dep expected. Gate: pull when matrix drift is noticed or the milestone-DoD compat:generate cycle (A-033) is automated.
