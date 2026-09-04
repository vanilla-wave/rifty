# no-COI dev/HMR restore evidence — 2026-09-04

## Baseline

Current public `ToolchainSandbox` exposes install/run only; its capability
report marks `toolchain.dev-hmr` throwing. Toolchain runtime reset throws
`NotImplementedError('sandbox.toolchain.restart')`. No resident start, sandbox
lifecycle event or pending-write marker exists.

Disposable real install probe, Playwright 1.60.0 / Chromium 148.0.7778.96:

```sh
pnpm test:no-coi -g "build parity: headerless SDK" --reporter=line
# 1 passed (1.6m)
# [no-coi-dev-probe] ... "viteCliPatched":false
```

The temporary observation was reverted. It proves the resident implementation
cannot rely on the COI Workbench Vite CLI preparation path. Historical HMR,
wedge, restart and durability observations remain in
`distribution/reference/no-coi-hmr-spike-record.md`.

## Contract RED

Playwright 1.60.0 / Chromium 148.0.7778.96:

```sh
pnpm test:no-coi tests/no-coi/no-coi-dev-hmr.spec.ts --reporter=line
# 3 failed in 13.8s
# generic + real Vite: SandboxToolchain.startBin is missing
# peer death: ToolchainSandbox.onLifecycle is missing

pnpm exec vitest run --project unit packages/runtime-js/src/host.test.ts -t "resident-bin input" --reporter=dot
# 1 failed / 28 skipped: toolchain.startBin is not a function
```

All Chromium failures occur after the public sandbox boots; the host unit fails
on the missing method before readiness because that is its exact subject. No
import/typecheck/setup failure substitutes for missing behavior. Existing
no-COI lane was GREEN before these designed REDs.

Post-review RED batch:

```sh
pnpm test:no-coi tests/no-coi/no-coi-dev-hmr.spec.ts --reporter=line
# 4 failed / 1 passed in 15.3s
# exact failures: capability still throwing; restart missing; generic and real startBin missing
# preservation: existing runtime exit:error + pending settlement passed

pnpm exec vitest run --project unit packages/runtime-js/src/host.test.ts -t "resident-bin input" --reporter=dot
# 1 failed / 28 skipped: startBin missing
```

The host RED now also pins immutable input, invalid exact shapes/ports and
pending-before-result. The Chromium overlap RED counts physical Worker
constructions and requires one fail-fast rejection.

## GREEN

Playwright 1.60.0 / Chromium 148.0.7778.96:

```sh
pnpm test:no-coi tests/no-coi/no-coi-dev-hmr.spec.ts --reporter=line
# 5 passed (17.7s)

pnpm test:no-coi --reporter=line
# 28 passed (2.0m)

pnpm exec vitest run --project unit packages/runtime-js/src/host.test.ts packages/rifty/src/sandbox.test.ts --reporter=dot
# 48 passed

pnpm test:packed-toolchain-surface
# PASS: 15 first-party + 72 external tarballs, strict types + SDK/Worker build

pnpm pr:check
# 24/24 PASS; test:run 209.9s; parity 77.2s
```

The real Vite case observes marker A→B with one bootId, a live CPU wedge with
no pre-restart exit event, one pending public write, explicit generation
replacement without registry traffic, repair-before-start, cache-busted iframe
assignment, recovered marker, and a second same-bootId HMR update. Dirty and
clean restart reports are `true` and `false`; physical Worker counts are exact.

## Final round 1 blocker batch

Final review found nine candidates; independent adjudication ruled seven
HOLDS and two STRETCH. The batch adds protocol-v2 mixed-peer rejection,
memory/backend recovery bytes, prebound/wrong-port ownership, post-resident
finite-op gaps, sticky failed-restart marker, getter reentry and post-dispose
Promise semantics.

```sh
pnpm test:no-coi tests/no-coi/no-coi-dev-hmr.spec.ts --reporter=line
# 9 passed (36.3s)

pnpm test:no-coi --reporter=line
# 32 passed (2.4m)

pnpm exec vitest run --project unit packages/runtime-js/src/host.test.ts packages/rifty/src/sandbox.test.ts --reporter=dot
# 48 passed

pnpm test:packed-toolchain-surface
# PASS: named start/restart SDK types + 15 first-party / 72 external tarballs

pnpm pr:check
# first run: test:run 205.4s + parity 76.1s GREEN, formatter-only RED
# after formatting: 24/24 PASS; test:run 195.8s; parity 77.1s
```

## Final round 2 blocker batch

Verify left two blockers; fresh adjudication ruled both HOLDS. The SDK now
refreshes its host recovery snapshot immediately before termination, so
acknowledged string and byte writes survive repeated memory generations.
Resident start drains tracked prior tasks before launch, rejects a target that
becomes occupied, allows selected auxiliary ports, and bounds missing-target
failure at ten seconds.

```sh
pnpm test:no-coi tests/no-coi/no-coi-dev-hmr.spec.ts --reporter=line
# 10 passed (41.4s)

pnpm test:no-coi --reporter=line
# 33 passed (2.5m)

pnpm pr:check
# 24/24 PASS; test:run 190.2s; parity 75.5s
```

## STOP-4 re-cut batch

Round-2 verify exposed an unref timer outside the ref-only drain. The re-cut
counts every live timeout/interval, refuses resident launch until the old
realm is timer-quiescent, and excludes runtime eval/fs frames during launch.
The Chromium carrier proves delayed unref rival rejection plus an allowed
auxiliary→requested-port lifecycle without a false readiness owner.

```sh
pnpm test:no-coi tests/no-coi/no-coi-dev-hmr.spec.ts --reporter=line
# 10 passed (42.1s)

pnpm test:no-coi --reporter=line
# 33 passed (2.5m)

pnpm pr:check
# 24/24 PASS; test:run 196.8s; parity 75.7s
```

## User-authorized re-cut RED

STOP-4 verify left five adjudicated HOLDS. The added batch fails on the
existing product for the exact missing behaviors:

```sh
pnpm exec vitest run --project unit packages/runtime-js/src/host.test.ts \
  -t "snapshots and exact-validates resident-bin input|records acknowledged root-relative aliases" --reporter=dot
# 2 failed: inherited iterator changed 5174→9999; /../escape.txt invalidated recovery

pnpm test:no-coi tests/no-coi/no-coi-dev-hmr.spec.ts \
  -g "public operations reject|resident readiness ignores|resident readiness rejects native|real Vite HMR" --reporter=line
# 4 failed: restart calls fulfilled/wrong TypeError; timer gate rejected; AbortSignal rival falsely won; build→dev hit resident-preflight
```

ADR-0378 replaces timer census with loader-bound port ownership.

```sh
pnpm exec vitest run --project unit <net/runtime/sdk ownership files> --reporter=dot
# 101 passed

pnpm test:no-coi tests/no-coi/no-coi-dev-hmr.spec.ts --reporter=line
# 12 passed (51.1s)

pnpm test:no-coi --reporter=line
# 35 passed (2.7m)

pnpm test:packed-toolchain-surface
# PASS: 15 first-party + 72 external tarballs, strict types + SDK/Worker build

pnpm pr:check
# 24/24 PASS; test:run 204.4s; parity 76.3s
```

## Final round 3 verify

Fresh Final+GREEN @ `f0ea22621` found four candidates; independent
adjudication ruled three HOLDS and one STRETCH. Remaining HOLDS: old
`createRequire` can acquire the selected loader facade, bind→immediate-close
can settle readiness without a live owned port, and owned HTTP/net facades
break Node's `createServer().constructor === Server` identity. Unit residuals
match those three; goal residual remains the final slice.
