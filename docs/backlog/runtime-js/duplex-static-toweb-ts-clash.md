---
area: runtime-js
status: draft
title: Duplex.toWeb static-side TS clash with inherited Readable.toWeb
created: 2026-07-01
why: Duplex.toWeb returns a {readable,writable} pair while the inherited Readable.toWeb returns a bare ReadableStream — TS's class-static-side assignability check (TS2417) forbids the divergence, so one `@ts-expect-error` carries it
user_story: As a rifty maintainer, I want the `Duplex.toWeb` static typed without a suppression, but TS cannot model a derived class whose same-named static intentionally returns a different shape than the base (mirrors Node's real API divergence).
epic: whatwg-stream-bridge
sources: [packages/io/src/streams/duplex.ts]
code: [packages/io/src/streams/duplex.ts, packages/io/src/streams/readable.ts]
---

## Context

`Duplex extends Readable`. Both expose static `toWeb`. Node's `Readable.toWeb(r)`
returns a `ReadableStream`; Node's `Duplex.toWeb(d)` returns `{ readable,
writable }`. TS's class-static-side check (TS2417) requires `typeof Duplex` to be
assignable to `typeof Readable`, which fails on the incompatible `toWeb` RETURN
types (a covariance violation, not fixable by widening params).

`fromWeb` (param divergence) and `from`/`compose` were reconciled cleanly (union
param + `override`, both runtime-guarded to Node's exact errors). Only `toWeb`'s
return divergence is genuinely inexpressible, so it carries ONE
`// @ts-expect-error TS2417` with a why-comment (the honest escape vs lying with a
`ReadableStream | {…}` union return the function never actually produces).

## Possible resolutions (pick at refine)

- Split the WHATWG-bridge statics onto a non-inherited carrier (free functions
  `duplexToWeb`/`duplexFromWeb` re-exported as `Duplex.toWeb` etc. via
  `Object.assign`), so no class-static-side check applies.
- Model the streams as interfaces the classes implement (drops concrete static
  inheritance), matching how `@types/node` sidesteps the same clash.
- Accept the single documented suppression as the lowest-risk option (current).

## Reversibility

REVERSIBLE — a typing-only cleanup; the runtime behaviour + public API are
already correct and parity-proven. No ADR.
