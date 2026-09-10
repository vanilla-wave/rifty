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
