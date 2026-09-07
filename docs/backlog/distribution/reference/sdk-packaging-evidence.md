# SDK packaging evidence

Baseline: accepted I2 @ f87f8994e; Node v24.16.0 / esbuild 0.28.0.

- Real packed main retains 49,447 B from io; sw 49,616 B. Both fail the declared
  5120 B threshold in `proveSdkPackaging` before product changes.
- Native-vs-minified io scenario matches byte aliasing, encoding, events and
  stream bytes, but names differ: Buffer=S, EventEmitter=O, Stream=Q (Node:
  Buffer/EventEmitter/Stream). Unminified dist Buffer also reports _Buffer.
  Existing callable stream helper explicitly preserves names for the other five.
- `pnpm exec vitest run tests/integration/workbench-source-entry.test.ts`: RED,
  actual bare-import wrapper entry is zero bytes. Summing all emitted files
  would lie: esbuild emits orphan dynamic chunks even when entry was dropped.
- SDK has no deferred generic backend entry on baseline; explicit placement
  remains part of this cleanup, preserving the existing bootVfs failure outcome.

Root owners/sweep: Buffer installers+brand, EventEmitter callable/prototype and
static wiring, legacy Stream prototype links; five callable stream constructor
factories; four captured native getter lookups; workbench's six exported source
worker entries. Shared gate uses native Node plus minified packed code. No
coordination/transport added. Package transformation is deterministic; network
fault applies only to the newly deferred generic backend import, with real
request abort at that boundary.

Reproduce packed RED: `node tests/integration/workbench-packed-consumer.mjs
--surface-only --keep`; focused runner imports `proveSdkPackaging` and reads
that consumer's measure/report.json. The same helper's browser phase checks
source wrapper boot and generic backend success/fault after byte/semantic GREEN.

GREEN (2026-09-07): real packed consumer, 15 first-party + 72 external tarballs;
strict TypeScript and all compiler/VM/SDK browser proofs pass. Main 56,861 B min /
18,033 B gzip; sw 14,056 / 4,828. All eight constructor identities/names plus
byte/event/stream results match native Node. Generic-only backend fetch and
real aborted import preserve existing memory fallback/reason and worker fs.
Actual source wrapper boots and executes Buffer. Focused io/SDK/source suite:
701 tests pass.

Revert checks executed against the real packed package: restore baseline io
root → io byte/name guards fail; restore static SDK backend → deferred-entry
guard fails; move import outside bootVfs fallback → browser fault case throws;
remove source worker sideEffects flag → wrapper entry assertion fails (0 B).
All files restored, same complete packed proof GREEN.

Production e2e: 7/7 pass (Buffer realm, owner, Express/sqlite, Hono, Koa,
TypeScript editor, Webpack cold/HMR/reload). First full gate: package-surface
closed-list assertion failed and reproduced in isolation; expected metadata now
lists the same six source entries as the generator. Focused contract 2/2 GREEN;
no runtime expectation changed. io attribution: main 559 B, sw 628 B.
