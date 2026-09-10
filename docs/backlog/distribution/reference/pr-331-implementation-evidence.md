# PR #331 implementation evidence

## Authorities

Original source snapshots: issue325-source.json, issue326-source.json.
Actual user answer and independent scope review:
issues325-326-refine-evidence.md, issues325-326-methods-final-green.json.
Public shape/mechanism sweep: ADR-0418. No new observable scope choice.

## Reference

Node v24.16.0; native fs/promises: mkdtemp under node:os.tmpdir, recursive
mkdir src/deep, write a.txt = hello, readdir withFileTypes, stat, rename to
b.txt, readFile utf8, recursive rm src, stat removed file. Executed 2026-09-10:

```json
{"node":"v24.16.0","list":[{"name":"a.txt","isDirectory":false,"isFile":true}],"stat":{"isFile":true,"size":5},"content":"hello","removed":"ENOENT"}
```

SDK records expose VFS metadata, not the full Node Stats prototype. Shell
semantics reuse existing Shell and its differential tests; no alternate parser.
Native Chromium Worker termination/clone probe and versions recorded in
issues325-326-refine-evidence.md. Public cancellation/receipts are SDK semantics.

## RED before implementation

`pnpm exec vitest run packages/runtime-js/src/worker-fs-structured.test.ts`:
14 tests, 12 fail / 2 pass; repeated isolated with identical outcome. Missing
structured ops, swallowed persistence report, missing applied-effects errors
and accepted invalid write data/path. Real MemoryFsSync; only flush external
storage boundary controlled.

`RIFTY_NO_COI_PORT=5511 RIFTY_NO_COI_ORACLE_PORT=5512 RIFTY_NO_COI_RESOURCE_PORT=5513 pnpm exec playwright test --config playwright.no-coi.config.ts tests/no-coi/no-coi-agent-sdk.spec.ts`:
5/5 fail specifically `Missing public sandbox.project method`, after real
Worker boot. No import/typecheck/harness failure. Scenarios shared with packed
consumer at tests/integration/fixtures/no-coi-packed-toolchain-consumer/src/agent-scenarios.ts.

## Preparation route

Goal/map restate the reviewed drafts. Combined Contract+RED checks final FIT,
public shape, both units and RED carriers. Shared storage/command policy owns
one permanent FsSync view; no queue, retry, journal or independent host admission.

## Pickup carrier correction

Read-only inventory: tools/shadow-registry/src/runtime/runtime-adapters.ts checks
FsSync identity plus cwd; runtime/generated/esbuild-runtime.js refuses second
startup. Its callback FS captures physical paths. Per-call virtual namespaces
would change that identity. ADR-0418 therefore uses ordinary physical absolute
VFS paths for files and commands, with relative paths/cwd anchored at root.
This was agent-owned API design; #325/#326 required agreement, not a virtual
filesystem root. Permanent policy wrapper precedes loader/adapter capture.

Independent review `/root/contract_review` confirmed 12/14 unit RED, 5/5 browser
RED and native OPFS reachability: held createWritable keeps the raw write
pending; rejected QuotaExceededError currently resolves while bytes are visible.
No blockers; concerns require the final revised shape check before IMPLEMENT.

## Integrated implementation checks

2026-09-11: source no-coi-agent-sdk.spec.ts 5/5 PASS; host/recovery/Sandbox/policy
72/72 PASS. Actual Vite7.3.6 project.run build/edit/npm-rebuild/readonly/next
source proof PASS. Shared packed file/command/Stop/installed-build proof 4/4 PASS
on actual packed tarballs. Mandatory full packed gate additionally found eager
installer loading through the new static command import; command code now loads
on demand. Full rerun remains required.

Timer ownership: real Node unref timers do not fire after process exit; the
reusable Worker initially let one mutate the next invocation. Existing timer-id
registry cleanup: 19 tests PASS, revert-check 3/3 RED (timeout/interval/throwing
entry); timers preceding the invocation survive.

EROFS errno: Node getSystemErrorMap(-30) supplies code/description. New test
RED 2/4 (missing mapping), then 4/4 PASS after shared Node FS error mapping.

Additional real esbuild cwd and pending-request/context defects follow
ADR-0421; no caller-specific mock, explicit interval or artificial exported
promise substitutes for service lifetime proof.

## Gate criteria updates (PR-4)

- Workbench production file count 159→161 for the two ADR-0418 modules;
  exact exported source closure equality remains enforced.
- Generated esbuild client checksum follows ADR-0421 reviewed generator output;
  original upstream input hashes, patch anchors and negative payload tests remain.
- TypeScript worker stays 10,022,664 bytes; only its exact emitted fingerprint
  changes with shared runtime imports. Lexical compiler remains unchanged at
  4,893,418 bytes. No artifact ceiling or directory waiver changes (ADR-0391).

Initial full gate began before final integration and was stopped after source
changed. It reported 18 failed tests in 10 files (16 timeouts; simultaneous
other-worktree full gate, observed load15.4/29.0/20.9 on12CPUs). Non-timeout
failures: old production-file count and then-RED esbuild cwd/ref case. Its
incomplete isolated rerun does not establish GREEN; the final full gate must
repeat and complete its own isolated failures if any.

Isolated repeat completed: 9/10 files, 288/289 tests PASS. The sole reproduced
failure was a protocol test labelling v4 as a future version after v4 became
current. Future rejection now uses v5 and explicit retired-v3 coverage remains;
exact current-protocol acceptance is unchanged. No product error hidden.

## Stable pre-review verification

- All workspace typechecks PASS; lint and docs:check PASS.
- New browser suite: 7/7 PASS, including real Vite rebuild and live Node HTTP
  listener Stop. Listener RED previously settled exited0 while live; use the
  existing net-port query in awaitDrain, matching Node entry bootstrap.
- Final packed `pnpm test:client-bundles`: PASS. 15 first-party +72 external
  tarballs, strict consumer types/build, all four agent scenarios, existing
  install/VM/compiler/SDK proofs and unchanged bundle ceilings. Main66,120B;
  toolchain835,179B. Eager-installer regression is gone.
- Esbuild invocation cwd/ref native differential + regression suites:109 PASS;
  separate reverted cwd and refs guards both reproduce RED. Caught failure and
  live context/dispose included; no artificial keepalive interval.
- Isolated host protocol correction:32/32 PASS. Earlier other9 files:257 PASS;
  final combined full gate remains required before independent Final+GREEN.

Generated artifacts: full `pnpm snapshots:bake` rebuilt Vite/Vite8/TypeScript
archives; `check:snapshot-artifact-drift` PASS. Compatibility renderer now admits
the 13 declared unique patches (adds runtime-service-refs); generated matrix
records acquire-time cwd and upstream refs. No old patch or capability gap was
removed. These two pre-generation reds require a clean full gate rerun.
