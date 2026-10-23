# Compact dependency snapshots — acceptance evidence

BASE f37bfc517613d0e3618519ccbeeb3ed15fd5cc39; PR #388; ADR-0547.
Node v24.16.0, Chromium 148.0.7778.96, real npm Vite 7.3.6.

## Preparation

- `pnpm exec vitest run packages/workbench/src/glue/dep-snapshot-compact.contract.test.ts`:
  4 RED / 5 PASS before implementation. V5 unsupported; a compact marker on
  legacy v3 wrongly accepted. REDs committed as expected failures, then enabled.
- `pnpm test:packed-consumer`: real public producer emitted v4 for compact,
  `4 !== 5`; ordinary Vite production/typecheck/build had succeeded. Initial
  carrier-only dirent type error repaired before this meaningful RED.
- Unknown producer profile: raw RED resolved instead of rejecting before
  acquisition. Contract+RED PASS @ ec970a6df0f7c7ffa79bab718e99e9373ad9f3c1,
  JSON retained on PR #388.

## Executed acceptance

`node tests/integration/workbench-packed-consumer.mjs --keep` PASS:
16 first-party + 178 external tarballs; packed strict TypeScript/build;
full Chromium journey and benchmark reference host.

Same caller manifest/lock, public producer, exact extracted payload equality:

| gzip archive | Bytes |
|---|---:|
| Default replay | 9,770,979 |
| Explicit compact | 6,025,362 |
| Saved | 3,745,617 (38.33%) |

Compact has no replay namespace; installed `node_modules` bytes, including
esbuild-wasm, match ordinary output. This scenario only; no universal ratio.

Ordinary and compact each pass native no-COI SDK apply/read/edit/build,
closed-page OPFS reopen/build, default conflict, force reapply/build and update.
Compact preserves shared-cache bytes. Both pass native interruption/quota
checks and independent saved-file use. Zero registry/Eddy requests throughout.
Existing packed Workbench registry/snapshot-only build/dev/HMR/sqlite and
saved-state/preview journeys also pass.

Focused unit command: `pnpm exec vitest run
packages/workbench/src/glue/dep-snapshot-compact.contract.test.ts
packages/workbench/src/glue/dep-snapshot-producer.test.ts
packages/workbench/src/glue/dep-snapshot.test.ts
packages/workbench/src/glue/dep-snapshot-tar.test.ts` — 69 PASS. Compact performs
zero cache mkdir/write/flush; corrupt profile/cache/lock/path/identity rejects
before FS/flush. Ordinary replay closure/SRI and legacy codec remain covered.

## Boundaries

No saved-state migration, new install policy, registry fallback or offline
reinstall promise. Reapply remains an overlay; no added crash atomicity.
Replay-preserving deduplication remains a separate draft.

`pnpm pr:check` PASS: all 28 gates, related tests and full selected parity lane.
`pnpm docs:check` PASS after recording this evidence/map.

Independent Final+GREEN/CLOSE PASS at 5d1e38a0b88cab0b20b294ba878598cda175eaf9:
253 extracted payload files identical; BASE tar reader rejects v5; unknown,
missing and legacy profile markers and a compact replay namespace reject.
Landing verdict: `distribution/reference/compact-dependency-snapshots-final-green.json`.
All I1–I3 proven; no required residuals. Completed goal/unit removed at CLOSE.
