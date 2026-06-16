---
area: process-meta
status: active
title: Test-coverage debt ledger — missing parity/regression guards for already-wired seams
created: 2026-06-13
why: Several shipped or ADR-claimed behaviors have no test (and some ADRs cite test files that do not exist), so a regression in a live seam passes CI; consolidated into one ledger of missing-coverage entries — each a distinct, articulable failure mode — instead of one tiny file each.
user_story: As a rifty contributor, I want CI to catch regressions in live seams like subpath `exports` symbol sets, `EvalRequest.cwd`, time-delayed SSE streaming, and `bcrypt→bcryptjs` surface-equivalence, but today these have no guarding test (and some ADRs cite test files that do not exist) so a break ships green.
sources: [ADR-0018, ADR-0017, ADR-0019, ADR-0006]
code: [packages/runtime-js/package.json, packages/net/src/http/response.ts, packages/runtime-js/src/host.ts, tools/shadow-registry/src/index.ts]
---

## Context

Each entry is a live/claimed behavior with no guarding test (AGENTS.md: failing-test-first, parity is gold standard, never mock a sibling rifty package or the unit under test).

- **Subpath export symbols unpinned (ADR-0018 #2).** package.json `exports` grew 4→11; no test asserts each subpath's exported symbol set, so a rename/removal breaks consumers at runtime, not in CI. ADR-0018 #2 names `packages/runtime-js/tests/`, which does not exist. Add a test importing every `exports` key and asserting its expected symbol set (drive it off the keys so new subpaths must register). The `./host` consolidation is a separate public-API decision, not this gap.
- **Host→worker EvalRequest.cwd untested (ADR-0019).** `RuntimeController.eval` → `EvalRequest.cwd` → worker-entry → `setProcessCwd` is live (protocol.ts:12, host.ts:259, worker-entry.ts:54) but only `setProcessCwd`-direct tests exist; ADR-0019:49 cites a `host-eval-cwd.test.ts` that does not exist. Add a host-level test asserting the eval message carries `cwd`, plus a relative-path parity case resolving against the seeded cwd.
- **Long-poll/SSE time-delayed streaming untested (ADR-0017 #1).** `server-streaming-drain.case.ts` pumps 500 chunks synchronously; no test asserts a `ServerResponse` that delays writes across time while a consumer reads early chunks before `end()`. Add a parity/unit case: write → real delay → write → `end()`; the reader asserts each chunk is decodable before `end()` resolves. The cross-realm end-to-end checkbox stays gated on the M12 resolve-on-start v3 bridge.
- **Shadow-registry substitutes unverified vs replaced API (ADR-0006).** Tests assert only the lookup value (`bcrypt→bcryptjs` string); nothing proves bcryptjs is drop-in for bcrypt's surface (genSalt/hash/compare). The import-time esbuild passthrough shim is a no-op asserted by a string check. Add a surface-equivalence test for bcrypt→bcryptjs (vendored, no network), and either contract-test or retire the esbuild passthrough (the real WASI transform is already parity-tested via ADR-0047). Generalize: every `bakedOverrides` entry needs an add-time surface-equivalence test.
- **Cross-realm editor-write → exec-read untested (D-acceptance B2).** The editor/`vfs-write-port`→owner write AND the child `SyncRpcFsSync` remote read both ship, but no test writes a user file via the editor/port then execs a script (owner or child) that reads the same path and asserts the NEW bytes — so "no stale PAGE store shadows the owner" is unproven. Add an e2e: editor/`sendVfsWrite` a file → run a node script that `readFileSync`s it → assert new content. (`m10-hmr` writes via the editor but asserts HMR render, not an exec read, and is opt-in skipped.)
- **PAGE-viewer vs exec byte-identity untested (D-acceptance B6).** Nothing reads the same file from the PAGE viewer (`SnapshotFs`) AND from inside exec and asserts identical bytes — `owner-explorer-coherence` asserts only treeitem visibility, `sandbox-fs-rpc` round-trips within ONE runtime worker. Over-cap (>128KB) snapshot files carry no content (`snapshot-fs`), so byte-identity is structurally impossible for those — scope the test to in-cap files (or treat the gap as a real divergence to fix, not just cover).
- **restore→exec composite untested (D-acceptance B4 / M11).** `owner-persistence-reload` asserts write→reload→`cat` (a READ after restore); `owner-shell-cowsay` asserts install→exec with no reload. No single spec does create→write→exec→snapshot/teardown→restore→exec, so a post-reload regression in OPFS-persisted `node_modules`/exec resolution passes CI. Add the composite spec.
- **Responsiveness-under-read-load untested (D-acceptance B5).** `owner-shell-responsive` proves owner-supervisor concurrency + Ctrl-C (the block is a get-stdin block), not a read-heavy/watch load with a PAGE main-thread responsiveness assertion; the CPU-bound non-stall is recorded only in ADR-0150 prose, and the canonical sustained-read case (`vite` transform burst) runs co-resident until P6b. Add a read-heavy/long-task responsiveness probe (gated on a shipped CPU-hog bin or P6b).
- **COI specs claim "chromium-only" without a skip-guard.** `owner-shell-cowsay.spec.ts` (+ `execsync-sab.spec.ts`) say chromium-only in prose but have no `test.skip(browserName!=='chromium')`; `playwright.config` defines firefox+webkit projects with no in-spec guard, so on those projects they FAIL (no SAB/COI) rather than skip. Add the skip guard (or scope the projects).

## Options or Next

Each is a pure test addition (prefer a node-parity case where applicable), independently landable. Plus two one-line ADR path corrections (ADR-0018 #2, ADR-0019:49) that go through the doc process (active ADRs immutable — see documentation-debt). No behavior change.

## Reversibility

REVERSIBLE — test-only additions. Any follow-on design (`./host` consolidation, the M12 resolve-on-start v3 wire) is separate and IRREVERSIBLE → its own ADR.
