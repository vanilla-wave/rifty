# M11 Backlog Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every M11-tagged backlog item on top of PR #21, with one commit per item and an up-to-date decisions log.

**Architecture:** Active items get code/doc/test closure. Parked or blocked residuals are retargeted out of the M11 live set only when their own gate text proves they are future public API, future ADR, or confirm-first outward work. Final proof is `rg -n "M11" docs/backlog` returning no M11 backlog item.

**Tech Stack:** TypeScript, Vitest, node-parity-runner, Vite playground, ADR/backlog docs, pnpm workspace commands.

---

## File Structure

- `docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md` records every closure/retarget decision.
- `docs/backlog/**` remains the source of open non-M11 residual work.
- `docs/adr/**` records irreversible decisions, especially toolchain parity oracle changes.
- `tools/node-parity-runner/**` owns parity harness decisions and cases.
- `apps/playground/**` owns playground prod proxy, storage UX, and export/import helpers.
- `packages/runtime-js/**` owns `node:vm`, source-map stack remapping, and builtin registration.
- `docs/public/compat/**` owns the public compatibility claim surface.

## Execution Rules

- One backlog item per commit. If a commit touches shared docs such as
  `docs/backlog/distribution/README.md`, touch only the row related to that item.
- For code-bearing tasks, write the failing test first and run the narrow command
  to prove the red leg.
- After each item, request/review focused code review before moving to the next
  item.
- Do not deploy, publish, push, delete user data, or spend money.

### Task 1: Ratify `toolchain-build/ts-esm-parity-node-reference`

**Files:**
- Create: new ADR file printed by `pnpm adr:new toolchain-build "TS ESM parity uses full-transform Node reference"`
- Modify: `docs/adr/README.md`
- Modify: `tools/node-parity-runner/src/run-in-node.ts`
- Modify: `tools/node-parity-runner/src/types.ts`
- Modify: `tools/node-parity-runner/README.md`
- Modify: `docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md`
- Delete: `docs/backlog/toolchain-build/ts-esm-parity-node-reference.md`

- [ ] **Step 1: Verify current behavior before docs changes**

Run:

```bash
pnpm test:parity
```

Expected: `modules/ts-strip-smoke.case.ts` and `modules/ts-graph-cross-file.case.ts` match. If the full run is too slow, run it once anyway for this oracle decision because the CLI has no single-case filter.

- [ ] **Step 2: Create ADR scaffold**

Run:

```bash
pnpm adr:new toolchain-build "TS ESM parity uses full-transform Node reference"
```

Expected: a new ADR file under `docs/adr/toolchain-build/` and a new README index row.

- [ ] **Step 3: Fill the ADR**

Use this decision content:

```markdown
Status: Accepted
Date: 2026-06

> TL;DR: `kind: 'ts-esm'` parity runs the Node side through vendored `tsx`, not Node native strip-only TypeScript, so both sides compare full TS transforms.

## Context

The parity runner's `ts-esm` mode compares rifty's esbuild-backed TypeScript transform with real Node output. Node v24's native TypeScript stripping is strip-only and rejects runtime-codegen syntax such as `enum` and parameter properties. The gold `modules/ts-graph-cross-file.case.ts` case intentionally uses `enum`, which esbuild and `tsx` lower but Node strip-only rejects.

## Decision

Always run `ts-esm` parity entries through the workspace-vendored `tsx` CLI on the Node side. Do not branch on Node major version for native strip-only execution. The contract under test is full transform vs full transform, not Node's native strip-only coverage.

## Consequences

- Codegen TS parity cases can stay in the gold runner.
- The runner no longer exercises Node native strip-only behavior.
- Native strip-only coverage can be added later as a separate case kind if needed.
```

- [ ] **Step 4: Remove backlog markers and stale README text**

Remove the two `toolchain-build/ts-esm-parity-node-reference` backlog marker comments from `run-in-node.ts` and `types.ts`. Update `tools/node-parity-runner/README.md` so the `ts-esm` section says the Node side runs through vendored `tsx`, not Node v24 native strip-types.

- [ ] **Step 5: Delete backlog item and append decision**

Delete `docs/backlog/toolchain-build/ts-esm-parity-node-reference.md`. Append `D9` to the decisions log: ADR ratified the full-transform Node reference; no public package API changed.

- [ ] **Step 6: Verify**

Run:

```bash
pnpm test:parity
pnpm docs:check
```

Expected: parity cases match; backlog and refs checks pass.

- [ ] **Step 7: Commit**

```bash
git add docs/adr docs/backlog/toolchain-build/ts-esm-parity-node-reference.md tools/node-parity-runner docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md
git commit -m "docs(toolchain): ratify ts-esm parity oracle"
```

### Task 2: Close `npm-client/prod-npm-registry-proxy`

**Files:**
- Create: `netlify/functions/npm-registry.mts`
- Create/update: `tests/integration/prod-npm-registry-proxy.test.ts`
- Modify: `docs/backlog/npm-client/prod-npm-registry-proxy.md` or delete it after closure
- Modify: `docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md`
- Modify: `apps/playground/CHANGELOG.md`

- [ ] **Step 1: Write failing proxy tests**

Create tests that import the handler helper and use a fake `fetch`:

```ts
it('proxies scoped package metadata with COI-safe headers', async () => {
  const calls: string[] = [];
  const response = await handleNpmRegistryRequest(
    new Request('https://site.test/npm-registry/@scope/pkg?foo=1'),
    async (url) => {
      calls.push(String(url));
      return new Response('{"name":"@scope/pkg"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  );

  expect(calls).toEqual(['https://registry.npmjs.org/@scope/pkg?foo=1']);
  expect(response.headers.get('access-control-allow-origin')).toBe('*');
  expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
  expect(await response.text()).toBe('{"name":"@scope/pkg"}');
});
```

Run:

```bash
pnpm vitest run tests/integration/prod-npm-registry-proxy.test.ts
```

Expected: fail because the handler does not exist.

- [ ] **Step 2: Implement minimal Edge handler**

Implement `handleNpmRegistryRequest(request, fetcher = fetch)` plus default export. Preserve path suffix and query. Use env-config for the upstream with default `/npm-registry` consumer behavior unchanged:

```ts
const DEFAULT_UPSTREAM = 'https://registry.npmjs.org';
const upstreamBase =
  process.env.RIFTY_NPM_REGISTRY_UPSTREAM?.replace(/\/$/, '') ?? DEFAULT_UPSTREAM;
```

Set `Access-Control-Allow-Origin: *`, `Cross-Origin-Resource-Policy: cross-origin`, and preserve upstream `content-type`.

- [ ] **Step 3: Verify**

Run:

```bash
pnpm vitest run tests/integration/prod-npm-registry-proxy.test.ts packages/npm-client/src/registry.test.ts
pnpm docs:check
```

Expected: tests pass; docs check passes.

- [ ] **Step 4: Close backlog item**

Delete `docs/backlog/npm-client/prod-npm-registry-proxy.md` if the source/test closure is enough. If live deploy verification is still required, retarget the residual to a non-M11 deploy-check backlog item without `M11` text and record the confirm-first boundary.

- [ ] **Step 5: Commit**

```bash
git add api docs/backlog/npm-client apps/playground/CHANGELOG.md docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md
git commit -m "feat(playground): add prod npm registry proxy"
```

### Task 3: Close `runtime-js/vm-subset-node-test-support`

**Files:**
- Create: `packages/runtime-js/src/builtins/vm.ts`
- Create: `tools/node-parity-runner/cases/vm/run-in-this-context.case.ts`
- Create: `tools/node-parity-runner/cases/vm/run-in-new-context.case.ts`
- Create: `tests/conformance/builtins/vm.test.ts`
- Modify: `packages/runtime-js/src/builtins/index.ts`
- Modify: `packages/runtime-js/src/builtins/misc-stubs.ts`
- Modify: `docs/public/compat/modules.md`
- Modify or delete: `docs/backlog/runtime-js/vm-subset-node-test-support.md`
- Modify: `packages/runtime-js/CHANGELOG.md`
- Modify: `docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md`

- [ ] **Step 1: Write failing parity/conformance tests**

Add parity cases for:

```ts
const vm = require('node:vm');
console.log(vm.runInThisContext('1 + 2'));
console.log(new vm.Script('globalThis.__vmParity = 7; __vmParity').runInThisContext());
```

and:

```ts
const vm = require('node:vm');
const sandbox = { a: 2 };
const result = vm.runInNewContext('a += 5; a', sandbox);
console.log(result);
console.log(sandbox.a);
console.log(vm.isContext(vm.createContext({})));
```

Add conformance for unsupported options:

```ts
expect(() => vm.runInThisContext('1', { timeout: 1 })).toThrow(NotImplementedError);
```

Run:

```bash
pnpm test:parity
pnpm vitest run tests/conformance/builtins/vm.test.ts
```

Expected: fail because `node:vm` is currently a loud proxy.

- [ ] **Step 2: Implement minimal `node:vm`**

Implement `Script`, `createContext`, `isContext`, `runInThisContext`, `runInNewContext`, and `compileFunction` using `new Function`. Sandbox context is a property bag, not true isolation. Unsupported options throw `NotImplementedError('vm.unsupportedOption')` with the actual option name.

- [ ] **Step 3: Decide `node:test` residual**

If no deliberately tiny tested runner is implemented in this task, replace the original backlog file with a non-M11 residual for `node:test` runner support and remove all M11 text. Record D10 in the decisions log.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm test:parity
pnpm vitest run tests/conformance/builtins/vm.test.ts tests/integration/builtins-via-require.test.ts
pnpm docs:check
```

Expected: parity and conformance pass; no `runtime-js/vm-subset-node-test-support` M11 item remains.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime-js tools/node-parity-runner/cases/vm tests/conformance/builtins/vm.test.ts docs/public/compat/modules.md docs/backlog/runtime-js docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md
git commit -m "feat(runtime-js): add honest node vm subset"
```

### Task 4: Close `runtime-js/sourcemap-remapping-error-overlay`

**Files:**
- Create: `packages/runtime-js/src/module-loader/source-maps.ts`
- Create: `packages/runtime-js/src/module-loader/source-map-remap.test.ts`
- Create: `tools/node-parity-runner/cases/modules/ts-stack-remap.case.ts`
- Modify: `packages/runtime-js/src/module-loader/loader.ts`
- Modify: `packages/runtime-js/src/module-loader/esm.ts`
- Modify: `tools/node-parity-runner/src/run-in-rifty.ts`
- Modify or delete: `docs/backlog/runtime-js/sourcemap-remapping-error-overlay.md`
- Modify: `packages/runtime-js/CHANGELOG.md`
- Modify: `docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md`

- [ ] **Step 1: Write failing stack-remap tests**

Loader unit test:

```ts
const loader = createModuleLoader(vfs, {
  cwd: '/work',
  transformSource: async () => [
    'const x = 1;',
    'throw new Error("boom");',
    '//# sourceMappingURL=data:application/json;base64,...',
  ].join('\n'),
});
await expect(loader.import('./main.ts', '/work/e.ts')).rejects.toThrow(/main.ts:5/);
```

Parity case: throw/catch in a `kind: 'ts-esm'` file and print the first `main.ts:line:column` frame from `err.stack`.

Run:

```bash
pnpm vitest run packages/runtime-js/src/module-loader/source-map-remap.test.ts
pnpm test:parity
```

Expected: fail because maps are not parsed/registered.

- [ ] **Step 2: Implement map extraction and remap**

Keep `TransformSourceHook` as `Promise<string>`. Extract an inline sourcemap from transformed source, register by resolved id, remove or ignore the map comment for execution, and install scoped stack rewriting for errors thrown during guest ESM execution. Clear maps in `loader.invalidate(id)` and `loader.invalidate()`.

- [ ] **Step 3: Retarget overlay/worker tail if not implemented**

If the runtime loader remap is implemented but visual overlay or spawned-worker remap is not, replace the original backlog with a non-M11 residual item that cites the closed loader slice. Remove all M11 text and record the split.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm vitest run packages/runtime-js/src/module-loader/source-map-remap.test.ts packages/runtime-js/src/module-loader/loader-transform.test.ts
pnpm test:parity
pnpm docs:check
```

Expected: tests pass; docs check passes.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime-js tools/node-parity-runner/cases/modules/ts-stack-remap.case.ts tools/node-parity-runner/src/run-in-rifty.ts docs/backlog/runtime-js docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md
git commit -m "feat(runtime-js): remap transformed ts stacks"
```

### Task 5: Close `vfs/storage-durability-and-portability`

**Files:**
- Create: `apps/playground/src/glue/storage-status.ts`
- Create: `apps/playground/src/glue/storage-status.test.ts`
- Create: `apps/playground/src/glue/workspace-archive.ts`
- Create: `apps/playground/src/glue/workspace-archive.test.ts`
- Modify: `apps/playground/src/boot.ts`
- Modify: `apps/playground/src/boot.test.ts`
- Modify: `apps/playground/src/components/StatusBar.tsx` or `CapabilitiesPanel.tsx`
- Modify or delete: `docs/backlog/vfs/storage-durability-and-portability.md`
- Modify: `apps/playground/CHANGELOG.md`
- Modify: `docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md`

- [ ] **Step 1: Write failing storage helper tests**

Test fake `navigator.storage`:

```ts
const status = await probeStoragePersistence({
  storage: {
    persisted: async () => false,
    persist: async () => true,
    estimate: async () => ({ usage: 10, quota: 100 }),
  },
});
expect(status).toEqual({ persistedBefore: false, persistedAfter: true, usage: 10, quota: 100 });
```

Run:

```bash
pnpm vitest run apps/playground/src/glue/storage-status.test.ts
```

Expected: fail because helper does not exist.

- [ ] **Step 2: Write failing archive tests**

Use `MemoryFsSync` or the existing snapshot shape to prove export/import of `/workspace` source files, excluding `node_modules`, `.git`, `.vite`, and `dist`, with no new dependency:

```ts
const archive = exportWorkspaceArchive(fs, '/workspace');
importWorkspaceArchive(target, archive);
expect(text(target.readFileBytesSync('/workspace/src/main.ts'))).toBe('...');
expect(target.existsSync('/workspace/node_modules/pkg/index.js')).toBe(false);
```

- [ ] **Step 3: Implement helpers and wire boot/status**

Call `persisted()`, `persist()`, and `estimate()` from a helper. Surface status in existing status/capabilities UI without adding explanatory onboarding text. Implement JSON archive v1 with version, root, and base64 file contents.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm vitest run apps/playground/src/glue/storage-status.test.ts apps/playground/src/glue/workspace-archive.test.ts apps/playground/src/boot.test.ts
pnpm docs:check
```

Expected: tests and docs pass.

- [ ] **Step 5: Commit**

```bash
git add apps/playground/src/glue/storage-status.ts apps/playground/src/glue/storage-status.test.ts apps/playground/src/glue/workspace-archive.ts apps/playground/src/glue/workspace-archive.test.ts apps/playground/src/boot.ts apps/playground/src/boot.test.ts apps/playground/src/components apps/playground/CHANGELOG.md docs/backlog/vfs/storage-durability-and-portability.md docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md
git commit -m "feat(playground): add storage persistence and workspace archive"
```

### Task 6: Close `process-meta/compat-generate-on-milestone-dod`

**Files:**
- Modify: `tools/compat-matrix-generator/cli.js`
- Create or modify: `docs/public/compat/fs.md`
- Create or modify: `docs/public/compat/streams.md`
- Create or modify: `docs/public/compat/http.md`
- Modify: `docs/public/compat/README.md`
- Delete: `docs/backlog/process-meta/compat-generate-on-milestone-dod.md`
- Modify: `docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md`

- [ ] **Step 1: Write failing generator expectation**

Run:

```bash
pnpm compat:generate
```

Expected before implementation: output still says full regeneration is not wired and no fs/streams/http matrix pages are produced.

- [ ] **Step 2: Implement minimal deterministic matrices**

Teach the generator to write fs/streams/http markdown from static inventories based on existing conformance/parity files. Keep the broader JSON reporter automation out of scope.

- [ ] **Step 3: Verify generated docs**

Run:

```bash
pnpm compat:generate
pnpm docs:check
pnpm vitest run tests/conformance/builtins/fs.test.ts tests/conformance/builtins/fs-streams.test.ts tests/conformance/builtins/http.test.ts tests/conformance/builtins/stream.test.ts
```

Expected: generator writes deterministic docs; docs check and conformance pass.

- [ ] **Step 4: Commit**

```bash
git add tools/compat-matrix-generator/cli.js docs/public/compat docs/backlog/process-meta/compat-generate-on-milestone-dod.md docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md
git commit -m "docs(compat): publish M11 fs streams http matrices"
```

### Task 7: Retarget `kernel/host-operator-resource-enforcement`

**Files:**
- Modify: `docs/backlog/kernel/host-operator-resource-enforcement.md`
- Modify: `docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md`

- [ ] Remove `M11` from sources/body and phrase it as future host-operator policy work.
- [ ] Append a decision log entry citing the future public behavior gate.
- [ ] Run `pnpm docs:check` and `rg -n "M11" docs/backlog/kernel/host-operator-resource-enforcement.md`; expect docs OK and no match in this file.
- [ ] Commit with `git commit -m "docs(backlog): retarget host resource policy beyond M11"`.

### Task 8: Retarget `kernel/server-shaped-worker-process-lifecycle`

**Files:**
- Modify: `docs/backlog/kernel/server-shaped-worker-process-lifecycle.md`
- Modify: `docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md`

- [ ] Remove `M11` wording and keep the existing kernel-native lifecycle ADR gate.
- [ ] Append a decision log entry citing the future kernel public contract gate.
- [ ] Run `pnpm docs:check` and `rg -n "M11" docs/backlog/kernel/server-shaped-worker-process-lifecycle.md`; expect docs OK and no match in this file.
- [ ] Commit with `git commit -m "docs(backlog): retarget server worker lifecycle beyond M11"`.

### Task 9: Retarget `runtime-js/crypto-sync-subset-expansion`

**Files:**
- Modify: `docs/backlog/runtime-js/crypto-sync-subset-expansion.md`
- Modify: `docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md`

- [ ] Remove `M11` wording and keep the verified-consumer gate for sync ciphers/KDF/sign.
- [ ] Append a decision log entry citing the pure-JS crypto correctness gate.
- [ ] Run `pnpm docs:check` and `rg -n "M11" docs/backlog/runtime-js/crypto-sync-subset-expansion.md`; expect docs OK and no match in this file.
- [ ] Commit with `git commit -m "docs(backlog): retarget crypto subset expansion beyond M11"`.

### Task 10: Retarget `runtime-js/platform-arch-adoption-friction`

**Files:**
- Modify: `docs/backlog/runtime-js/platform-arch-adoption-friction.md`
- Modify: `docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md`

- [ ] Remove `M11` wording and keep blocked status because reconsidering ADR-0026 needs a decision subagent and superseding ADR.
- [ ] Append a decision log entry citing the active ADR contradiction gate.
- [ ] Run `pnpm docs:check` and `rg -n "M11" docs/backlog/runtime-js/platform-arch-adoption-friction.md`; expect docs OK and no match in this file.
- [ ] Commit with `git commit -m "docs(backlog): retarget platform arch decision beyond M11"`.

### Task 11: Retarget `runtime-js/fs-promises-filehandle`

**Files:**
- Modify: `docs/backlog/runtime-js/fs-promises-filehandle.md`
- Modify: `docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md`

- [ ] Remove `M11` wording and keep the FileHandle verified-package gate.
- [ ] Append a decision log entry citing the larger lifetime-semantics surface.
- [ ] Run `pnpm docs:check` and `rg -n "M11" docs/backlog/runtime-js/fs-promises-filehandle.md`; expect docs OK and no match in this file.
- [ ] Commit with `git commit -m "docs(backlog): retarget fs promises filehandle beyond M11"`.

### Task 12: Retarget `vfs/fs-sync-fd-api-and-fsync-durability`

**Files:**
- Modify: `docs/backlog/vfs/fs-sync-fd-api-and-fsync-durability.md`
- Modify: `docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md`

- [ ] Remove `M11` wording and keep the lower-layer `FsSync` public API ADR gate.
- [ ] Append a decision log entry citing the inode-like fd and durability contract gate.
- [ ] Run `pnpm docs:check` and `rg -n "M11" docs/backlog/vfs/fs-sync-fd-api-and-fsync-durability.md`; expect docs OK and no match in this file.
- [ ] Commit with `git commit -m "docs(backlog): retarget vfs fd durability beyond M11"`.

### Task 13: Retarget `runtime-wasi/runwasi-kernel-dispatch-wiring`

**Files:**
- Modify: `docs/backlog/runtime-wasi/runwasi-kernel-dispatch-wiring.md`
- Modify: `docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md`

- [ ] Remove `M11` wording and keep the ADR-0038 dispatch-confirmation gate.
- [ ] Append a decision log entry citing the runWasi worker dispatch verification gate.
- [ ] Run `pnpm docs:check` and `rg -n "M11" docs/backlog/runtime-wasi/runwasi-kernel-dispatch-wiring.md`; expect docs OK and no match in this file.
- [ ] Commit with `git commit -m "docs(backlog): retarget runwasi dispatch beyond M11"`.

### Task 14: Retarget `net/readable-fromweb-pipe-sink`

**Files:**
- Modify: `docs/backlog/net/readable-fromweb-pipe-sink.md`
- Modify: `docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md`

- [ ] Remove `M11` wording and keep the verified web-stream response consumer gate.
- [ ] Append a decision log entry citing the `Readable.fromWeb` owner gate.
- [ ] Run `pnpm docs:check` and `rg -n "M11" docs/backlog/net/readable-fromweb-pipe-sink.md`; expect docs OK and no match in this file.
- [ ] Commit with `git commit -m "docs(backlog): retarget fromweb pipe sink beyond M11"`.

### Task 15: Retarget `distribution/public-api-ai-agent-exec-preview`

**Files:**
- Modify: `docs/backlog/distribution/public-api-ai-agent-exec-preview.md`
- Modify: `docs/backlog/distribution/README.md`
- Modify: `docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md`

- [ ] Remove `M11` wording and keep the public `Sandbox.exec`/preview API ADR gate.
- [ ] Update only this item row in distribution README.
- [ ] Append a decision log entry citing the public API expansion gate.
- [ ] Run `pnpm docs:check` and `rg -n "M11" docs/backlog/distribution/public-api-ai-agent-exec-preview.md`; expect docs OK and no match in this file.
- [ ] Commit with `git commit -m "docs(backlog): retarget sandbox exec preview beyond M11"`.

### Task 16: Retarget `distribution/public-api-ai-agent-contract-snapshot-restore`

**Files:**
- Modify: `docs/backlog/distribution/public-api-ai-agent-contract-snapshot-restore.md`
- Modify: `docs/backlog/distribution/README.md`
- Modify: `docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md`

- [ ] Remove `M11` wording and keep the public snapshot/restore/fork API ADR gate.
- [ ] Update only this item row in distribution README.
- [ ] Append a decision log entry citing the snapshot semantics gate.
- [ ] Run `pnpm docs:check` and `rg -n "M11" docs/backlog/distribution/public-api-ai-agent-contract-snapshot-restore.md`; expect docs OK and no match in this file.
- [ ] Commit with `git commit -m "docs(backlog): retarget sandbox snapshot restore beyond M11"`.

### Task 17: Retarget `distribution/workbench-controllers`

**Files:**
- Modify: `docs/backlog/distribution/workbench-controllers.md`
- Modify: `docs/backlog/distribution/README.md`
- Modify: `docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md`

- [ ] Remove `M11` wording and keep the new package/public controller API ADR gate.
- [ ] Update only this item row in distribution README if it still says M11.
- [ ] Append a decision log entry citing the non-Solid consumer gate.
- [ ] Run `pnpm docs:check` and `rg -n "M11" docs/backlog/distribution/workbench-controllers.md`; expect docs OK and no match in this file.
- [ ] Commit with `git commit -m "docs(backlog): retarget workbench controllers beyond M11"`.

### Task 18: Retarget `distribution/create-rifty-template`

**Files:**
- Modify: `docs/backlog/distribution/create-rifty-template.md`
- Modify: `docs/backlog/distribution/README.md`
- Modify: `docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md`

- [ ] Remove `M11` wording and keep the scaffold/package-template pull gate.
- [ ] Update only this item row in distribution README.
- [ ] Append a decision log entry citing the host-template pull gate.
- [ ] Run `pnpm docs:check` and `rg -n "M11" docs/backlog/distribution/create-rifty-template.md`; expect docs OK and no match in this file.
- [ ] Commit with `git commit -m "docs(backlog): retarget create rifty template beyond M11"`.

### Task 19: Retarget `distribution/dependency-license-audit`

**Files:**
- Modify: `docs/backlog/distribution/dependency-license-audit.md`
- Modify: `docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md`

- [ ] Remove `M11` wording and keep it as a release-audit follow-up.
- [ ] Append a decision log entry citing the compliance inventory gate.
- [ ] Run `pnpm docs:check` and `rg -n "M11" docs/backlog/distribution/dependency-license-audit.md`; expect docs OK and no match in this file.
- [ ] Commit with `git commit -m "docs(backlog): retarget dependency license audit beyond M11"`.

### Final Verification

- [ ] **Step 1: Prove M11 backlog set is closed**

Run:

```bash
rg -n "M11" docs/backlog
```

Expected: no matches.

- [ ] **Step 2: Full local verification**

Run:

```bash
pnpm docs:check
pnpm typecheck
pnpm lint
pnpm check:deps
pnpm test:run
pnpm test:parity
pnpm compat:generate
```

Expected: all pass, or any failure is understood, fixed, and re-run.

- [ ] **Step 3: Final review**

Request a final code review over the full branch diff from `4ddfe4f` to `HEAD`.
