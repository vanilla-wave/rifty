# PR316 I7 — storage implementation and proof

2026-09-09. Scoped implementation after Contract+RED18/18
@0d11806a11a37c9bb1ae5cad985d1b7308196c04 (record1d50e17c2).
Authority: ready workbench-operation-budgets contract, ADR0410 and independent
preparation/evidence. No test changes, new timer owner, global setting or commit.

## Owned changes

- `packages/vfs/src/opfs-drain-scheduler.ts`: existing constructor captures
  readonly reportTimeoutMs (default30000); existing active-lane timer uses it.
  Scheduling,16 lanes, path/structural/capacity fences and ledger unchanged.
- `packages/vfs/src/opfs-sync.ts`: constructor/init accept optional
  `{ ioReportTimeoutMs }`; instance constructs its existing scheduler with the
  scalar. Timeout diagnostic uses that same selected value. `init` captures
  before awaiting native root/index/preload. Redundant old header shortened:
 1189→1167 `wc -l`, below1190 ratchet; cap not raised.
- `packages/vfs/src/sync-mirror.ts`: `installOpfsFs(root?,options?)` captures
  scalar before any async native install and forwards it to the paired instance.
- `packages/vfs/CHANGELOG.md`: per-instance configurable report bound/default/
  fencing/late-heal behavior recorded.
- `packages/workbench/src/workers/workbench-owner-storage.ts`: default installer
  captures and forwards ioReportTimeoutMs for both origin and namespaced OPFS.
  Existing proof/fallback authority remains unchanged.
- `packages/workbench/src/workers/workbench-owner-runtime.ts`: captured boot B
  reaches existing proofTimeoutMs; boot ioReportTimeoutMs reaches installer.
  Root supplied the agreed optional boot type/decoder/normalizer fields.

Options are not retained: mutations during async install or after installation
cannot replace captured instance values. Omitted IO remains30s; explicit10s and
90s use the same existing timer owner. Timeout reports only; actual native
completion retains/relinquishes lane/path fences and heals without resend.

## Executed GREEN

All commands from repository root; Node24.16.0, Chromium148.

```sh
pnpm exec biome check --write packages/vfs/src/opfs-drain-scheduler.ts packages/vfs/src/opfs-sync.ts packages/vfs/src/sync-mirror.ts packages/workbench/src/workers/workbench-owner-storage.ts packages/workbench/src/workers/workbench-owner-runtime.ts
pnpm exec vitest run --project unit packages/vfs/src/opfs-sync.test.ts packages/workbench/src/workers/workbench-owner-storage.test.ts --maxWorkers=1 --minWorkers=1
pnpm --filter @riftydev/vfs typecheck
pnpm --filter @riftydev/workbench typecheck
RIFTY_PLAYGROUND_PORT=5493 pnpm exec playwright test --config playwright.browser-unit.config.ts tests/browser-unit/operation-storage-budget.spec.ts --output=/tmp/rifty-316-i7-storage-native-results --reporter=line
```

- Biome5 files, no fixes; scoped `git diff --check` exit0.
- Unit2files,100PASS/1existing skip,612ms; `/tmp/rifty-316-i7-storage-unit.log`.
- VFS and Workbench typecheck exit0; `/tmp/rifty-316-i7-storage-{vfs,workbench}-typecheck.log`.
- Native8/8PASS,7.1s; `/tmp/rifty-316-i7-storage-native.log`.
  Explicit90 survives30 and reports90; explicit10 reports10; omission30.
  Caller mutation after install ignored.16 active writes/zero closes through
  reporting, same-path and capacity dependents held; late native release gives
 18 writes/closes, clean ledger, exact `second-0`/`capacity`, no resend.
  Public B90 close/read/cleanup yields actual persisted proof/durable OPFS;
  omitted B30 retains honest memory fallback; default storage installer IO90
  survives old30s cutoff. All accepted8 carriers preserved, no mocks introduced.

## Bounded revert proof

`/tmp/rifty-316-i7-storage-revert.py` changed exactly one scheduler timeout
argument: `this.reportTimeoutMs` → old
`PERSIST_OPERATION_REPORT_TIMEOUT_MS`. Original bytes retained and restored in
`finally`. No tests, parent-owned files or other implementation changed.

```sh
RIFTY_PLAYGROUND_PORT=5494 python3 /tmp/rifty-316-i7-storage-revert.py
RIFTY_PLAYGROUND_PORT=5495 pnpm exec playwright test --config playwright.browser-unit.config.ts tests/browser-unit/operation-storage-budget.spec.ts --grep 'native report' --output=/tmp/rifty-316-i7-storage-restored-native-results --reporter=line
```

Mutant exit1:2semanticRED/1defaultPASS,5.3s. Explicit90 reports at30 (must stay
pending); explicit10 still pending at10 (must report). No bootstrap/import RED.
Exact restoration followed by native3/3PASS,5.0s, exit0.

`/tmp/rifty-316-i7-storage-revert.log`,
`/tmp/rifty-316-i7-storage-restored-native.log`,
`/tmp/rifty-316-i7-storage-revert-digests.json`:

```text
before/restored:84b9d6f25c87f6495ad6f2a052acd8ec783a3f5169c5ebef13ddc3270c0e61d8
mutant:ed4f1d8a0e3a15a2bcc6d6535ce3f67e23283c6374d8348c679122393d4a8e6a
```

App SW remained byte-identical before/after all native runs:
`de38baa05d3835d5ca3573990acebad5a558d49dd3ad20ac78da62d82991f5cf`.
No App/package rebuild or fullgate/packed run. Parent resumed its own mutation
checks after exact restoration/GREEN confirmation. Integration/Final/commit
remain root-owned; this scoped storage implementation has no known residual.
