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
