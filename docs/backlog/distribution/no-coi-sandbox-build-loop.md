---
area: distribution
status: ready
title: no-COI installed-bin build parity through the generic sandbox authority
created: 2026-08-28
epic: no-coi-sandbox-tier
why: the public no-COI sandbox builds through an installed bin, but exact Node/COI/no-COI output, identity-equivalent Vite decoys and real installed fixture provenance need one current proof
user_story: As an agent platform, I want an arbitrary installed bin to build my project in a headerless sandbox and return the exact same dist bytes as the COI product, while a real shared-memory request fails by name and package identity never selects policy
sources: [ADR-0137, ADR-0174, ADR-0316, ADR-0376, docs/backlog/distribution/reference/no-coi-build-spike-record.md, docs/backlog/distribution/reference/no-coi-sandbox-build-loop-evidence.md, docs/backlog/distribution/reference/no-coi-sandbox-package-install-evidence.md]
code: [packages/workbench/src/workers/no-coi-toolchain-worker.ts, tests/no-coi/no-coi-sandbox-build-loop.spec.ts, tools/perf/child-fs/scenario.mjs, tools/perf/child-fs/vite-7.3.6-node-golden.json]
---

## Context

This is the I3 remainder of the original build-loop lineage after public
admission, lifecycle and exact-manifest install landed. It owns three Final
HOLDS from `c2b13d0f3`: request-identical Vite 7/8 decoys, exact installed Vite
8/nanoid provenance, and the exact full module-result line. Earlier descriptor
and bounded-cause splits are certified outside this boundary.

The product authority stays package-generic. Vite 7.3.6 is the representative
shared-memory-free build; Vite 8.0.16 reaches the threaded-WASM boundary; nanoid
is the ordinary installed-bin control. No product or infrastructure code may
branch on those identities.

The dated live evidence runs one canonical scenario under Node 24.16.0/Vite
7.3.6, the COI product and the public no-COI sandbox. All three currently emit
the same normalized `dist` paths, sizes and SHA-256. The older committed Node
golden reported 2195 modules because it pinned direct dependencies but not the
transitive closure; it remains historical evidence, not the current exact
oracle.

## Challenge

challenge: 2026-09-02 — 2 problems
- COI/no-COI equality alone can preserve shared drift without a real Node Vite
  oracle.
- Audience size is unsized against the proof cost after greenfield sites were
  excluded in favor of isolation.

Disposition:

- P1 answered by the dated live Node/COI/no-COI differential in the evidence
  record; its input identity and exact outputs are explicit.
- P2 is the frozen goal's user-accepted premise: existing own-origin apps that
  preserve host posture are the chosen audience. Goal I9 rejects the cheaper
  whole-document isolation route.

## User scenario

After certified admission, lifecycle and install, an agent runs an arbitrary
installed bin against the same Worker VFS. Vite 7 builds and exposes the exact
`dist` bytes produced by the COI product for identical input. Vite-named decoys
prove identity cannot select behavior. Real Vite 8 fails only when its bytes
request shared memory.

## Reference contract

- `docs/backlog/distribution/reference/no-coi-sandbox-build-loop-evidence.md`
  records Node 24.16.0, Playwright 1.60.0, Chromium 148.0.7778.96, exact input
  digests, output hashes and commands.
- ADR-0137/0174: caller-selected installed `.bin` plus
  `runNodeEntry(..., bin:true)`, never a curated callback.
- ADR-0316: registry-attested `esbuild-wasm@0.28.0`; no vendored second
  provider.
- ADR-0376: one generic Worker/VFS/runtime, exact installed-bin authority,
  lexical shared-memory boundary and bounded error projection.
- Headerless Chrome has no SharedArrayBuffer; Vite 8's installed Rolldown WASI
  binding requires pthread shared memory.

## Acceptance

1. The public no-COI sandbox invokes caller-selected
   `/project/node_modules/.bin/vite` with args exactly `['build']`; Vite 7 exits
   0 without curated callback/deep import. Normalized output contains exactly
   one full line `✓ 2180 modules transformed.`; `12180` cannot pass. → I3
2. Live Node 24.16.0/Vite 7.3.6, COI and no-COI receive one canonical
   project/direct-dependency digest and marker. Current complete normalized
   `dist` path sets, sizes and SHA-256 match across all three; marker occurs
   twice in JS. The committed browser carrier continuously binds COI=no-COI.
   → I3, scenario
3. Vite 7.3.6 and Vite 8.0.16 decoys use the same public run request fields,
   package identity, installed bin path and `['build']` args as real fixtures;
   only installed bytes differ. Both decoys run their own output, proving no
   identity/version/path/argv policy. → ADR-0376
4. Before execution, carriers read exact installed `vite@8.0.16` and
   `nanoid@3.3.18` manifests plus declared bin targets from Worker VFS. Real
   nanoid `.bin/nanoid --size 7` exits 0 with one seven-character id. → ADR-0376
5. Real installed Vite 8 reaches the certified realm-local shared-memory
   boundary and rejects `NotImplementedError('toolchain.threaded-wasm')` before
   `dist`; its identity-equivalent non-threaded decoy runs. → I3, ADR-0376
6. Certified lifecycle/install are consumed without adding Worker, VFS,
   protocol, busy, queue, registry or package authority. The Chromium lane and
   Node record are proof carriers only. → REV-7

## Parity cases

1. Node vs COI vs no-COI: one canonical scenario/direct-dependency digest,
   exit 0, exact normalized `dist` paths/sizes/SHA and two-site marker.
   Artifact: build-loop evidence §Build differential. → I3
2. Real/decoy Vite 7 and Vite 8 use identical run requests; installed bytes
   alone decide output or the shared-memory boundary. Artifact: build-loop
   evidence §Identity discrimination. → ADR-0376
3. Exact Vite 8/nanoid manifest versions and bin targets are observed before
   execution; nanoid is the non-Vite control. Artifact: build-loop evidence
   §Installed provenance. → ADR-0376
4. Real Vite 8 reaches the named generic boundary; its request-identical decoy
   runs. Descriptor/cause semantics remain certified predecessor scope.
   Artifact: build-loop evidence §Threaded WASM. → I3, ADR-0376

## Fault matrix

| axis × operation | honest outcome | reproducible artifact / fault target |
|---|---|---|
| `provenance-lie` × package/build policy | request-identical Vite decoys follow bytes, never identity | two-version decoy matrix → ADR-0376 |
| `frozen-assumption` × fixture identity | exact Vite 8/nanoid version and bin target before use | Worker-VFS reads → ADR-0376 |
| `lossy-aggregate` × module output | exact full line once; prefixed count fails | normalized-line carrier → I3 |
| `sibling-drift` + `frozen-assumption` + `lossy-aggregate` × Node/COI/no-COI build | dated live Node plus twin products; exact input and output digests | three-way differential → I3 |
| `false-fallback` × threaded WASM | real Vite 8 reaches named boundary; identical-request decoy runs | live fixtures + certified realm seam → I3, ADR-0376 |

## Out of scope

- Admission/report/protocol, exact-manifest install and operation lifecycle are
  certified predecessors; this slice consumes them.
- Native descriptor evaluation and bounded cause projection stay certified
  predecessor scope.
- Vite/nanoid identities are fixture provenance only, never product policy.
- No host-posture, resident dev/HMR, preview binding, restart/death event or
  pending-write marker; later children own them.
- No `sandbox.exec()`, shell grammar, stdin, cancellation, spawnSync/execSync
  implementation or threaded-WASM emulation.
- No heartbeat, journal, retry/reconnect, queue or crash durability.

## Decisions

review: ordinary — proof-only
re-cut: 2026-09-03 — removed copied predecessor lineage and retained only the active 15-row I3 contract — trace: none
- 2026-09-03 — expected RED band 3–4: exact module line, two-version request decoys, installed Vite8/nanoid provenance and live build differential.
- 2026-09-03 — historical 2195-module Node golden is not silently updated; current live Node closure/output is a dated evidence record.
