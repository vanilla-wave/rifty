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
