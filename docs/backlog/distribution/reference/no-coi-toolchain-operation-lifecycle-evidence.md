# No-COI toolchain operation lifecycle evidence

Captured 2026-09-03 from base `c190d3828`. Node `v24.16.0`, Playwright
`1.60.0`, Chromium `148.0.7778.96`. This proof-only successor adds
discriminating tests; product bytes stay unchanged.

## Class sweep

```sh
rg -n 'busy|activeRun|queue: Promise|pendingRequests|inFlight|Semaphore' \
  packages/runtime-js/src packages/workbench/src packages/npm-client/src \
  packages/terminal/src packages/git/src packages/ts-language-service/src \
  packages/vfs/src --glob '*.ts'
```

- Chosen outer install/run admission: Worker `busy`, reject-before-dispatch,
  result post, release (`no-coi-toolchain-worker.ts:142-160`).
- Host map: correlation and signalled peer-end settlement, not admission
  (`runtime-js/src/host.ts:153-154,226-276,329-364,373-395,444-455`).
- PTY/project active-run gates own UI/project/session scopes
  (`pty-server.ts:190-258,445-463`; `project-session.ts:84-120`).
- Owner/materializer/catalog and package/stamp FIFOs own lifecycle/durable-tree
  scopes and wait (`package-acquisition-authority.ts:446-459,695-778`;
  `install-stamp-authority.ts:141-147,190-197`).
- npm semaphores/in-flight maps bound and deduplicate acquisition inside one
  install (`installer-sources.ts:325-358`; `installer-walk.ts:261-279,315-362`).
- Git FIFO, TypeScript init promise and OPFS path scheduler own distinct repo,
  service-init and persistence boundaries (`exact-read-failures.ts:132-154`;
  `service-endpoint.ts:71-88`; `opfs-drain-scheduler.ts:1-39,80-98`).

ADR-0376 compares Worker-local admission, host admission, package/project FIFO
and per-operation Worker candidates and records the forcing constraint.

## Snapshot

Baseline:

```sh
pnpm exec vitest run packages/runtime-js/src/host.test.ts --reporter=dot
# 1 file, 28 tests passed
```

Mutant: both validators returned the caller-owned record instead of copied,
frozen values. Focused command:

```sh
pnpm exec vitest run packages/runtime-js/src/host.test.ts \
  -t 'snapshots validated install and run-bin inputs' --reporter=dot
# 1 failed: posted /changed-install, /registry-after,
# /changed-run/.../tool-after and ['after','extra']
```

## Peer end

The baseline command above passes the six install/run ×
dispose/crash/explicit-close cases. Mutant: explicit-close teardown omitted
`rejectPendingCalls`.

```sh
pnpm exec vitest run packages/runtime-js/src/host.test.ts \
  -t 'run-bin request exactly once when its peer ends by clean-close' \
  --reporter=dot
# 1 failed: test timed out at 5000 ms
```

## Overlap

Baseline, outside sandbox because three Vite servers need loopback binds:

```sh
pnpm test:no-coi -g \
  'toolchain overlap rejects|runBin preserves cross-stream output|toolchain disposal rejects' \
  --reporter=dot
# Running 3 tests; 3 passed (10.0s)
```

The overlap case runs install→install, install→run, run→install and run→run.
Each rejected operation has VFS, process and output sentinels. Mutant:
Worker `if (busy)` became `if (busy && false)`.

```sh
pnpm test:no-coi -g 'toolchain overlap rejects' --reporter=dot
# Running 1 test; 1 failed: install→install expected
# SandboxToolchainBusyError, received resolved
```

## Order

The baseline order carrier emits synchronous stdout A, then detached timer
stderr B/stdout C; public `runBin` resolves only after those events. Mutant:
`runInstalledBin` skipped `awaitDrain`.

```sh
pnpm test:no-coi -g 'runBin preserves cross-stream output' --reporter=dot
# Running 1 test; 1 failed: received stdout:A, result:0; B/C absent
```
