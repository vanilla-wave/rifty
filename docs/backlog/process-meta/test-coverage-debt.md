---
area: process-meta
status: active
title: Test-coverage debt ledger — missing parity/regression guards for already-wired seams
created: 2026-06-13
why: Several shipped or ADR-claimed behaviors have no test (and some ADRs cite test files that do not exist), so a regression in a live seam passes CI; consolidated into one ledger of missing-coverage entries — each a distinct, articulable failure mode — instead of one tiny file each.
sources: [ADR-0018, ADR-0017, ADR-0019, ADR-0006]
code: [packages/runtime-js/package.json, packages/net/src/http/response.ts, packages/runtime-js/src/host.ts, tools/shadow-registry/src/index.ts]
---

## Context

Each entry is a live/claimed behavior with no guarding test (AGENTS.md: failing-test-first, parity is gold standard, never mock a sibling rifty package or the unit under test).

- **Subpath export symbols unpinned (ADR-0018 #2).** package.json `exports` grew 4→11; no test asserts each subpath's exported symbol set, so a rename/removal breaks consumers at runtime, not in CI. ADR-0018 #2 names `packages/runtime-js/tests/`, which does not exist. Add a test importing every `exports` key and asserting its expected symbol set (drive it off the keys so new subpaths must register). The `./host` consolidation is a separate public-API decision, not this gap.
- **Host→worker EvalRequest.cwd untested (ADR-0019).** `RuntimeController.eval` → `EvalRequest.cwd` → worker-entry → `setProcessCwd` is live (protocol.ts:12, host.ts:259, worker-entry.ts:54) but only `setProcessCwd`-direct tests exist; ADR-0019:49 cites a `host-eval-cwd.test.ts` that does not exist. Add a host-level test asserting the eval message carries `cwd`, plus a relative-path parity case resolving against the seeded cwd.
- **Long-poll/SSE time-delayed streaming untested (ADR-0017 #1).** `server-streaming-drain.case.ts` pumps 500 chunks synchronously; no test asserts a `ServerResponse` that delays writes across time while a consumer reads early chunks before `end()`. Add a parity/unit case: write → real delay → write → `end()`; the reader asserts each chunk is decodable before `end()` resolves. The cross-realm end-to-end checkbox stays gated on the M12 resolve-on-start v3 bridge.
- **Shadow-registry substitutes unverified vs replaced API (ADR-0006).** Tests assert only the lookup value (`bcrypt→bcryptjs` string); nothing proves bcryptjs is drop-in for bcrypt's surface (genSalt/hash/compare). The import-time esbuild passthrough shim is a no-op asserted by a string check. Add a surface-equivalence test for bcrypt→bcryptjs (vendored, no network), and either contract-test or retire the esbuild passthrough (the real WASI transform is already parity-tested via ADR-0047). Generalize: every `bakedOverrides` entry needs an add-time surface-equivalence test.

## Options or Next

Each is a pure test addition (prefer a node-parity case where applicable), independently landable. Plus two one-line ADR path corrections (ADR-0018 #2, ADR-0019:49) that go through the doc process (active ADRs immutable — see documentation-debt). No behavior change.

## Reversibility

REVERSIBLE — test-only additions. Any follow-on design (`./host` consolidation, the M12 resolve-on-start v3 wire) is separate and IRREVERSIBLE → its own ADR.
