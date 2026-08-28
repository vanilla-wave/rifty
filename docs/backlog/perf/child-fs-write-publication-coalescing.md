---
area: perf
status: draft
title: child writeChunk runs full owner publication per 256 KiB chunk — 4.4 s of a ~6 s product vite build
created: 2026-08-27
why: measured, not modeled — instrumented product lane run (2026-08-27, d4caf2e6a + uncommitted per-method counters in sync-dispatch + child-blocked timers in sync-rpc-fs): child blocked 7.49 s of a 10.75 s `vite build` command in sync-RPC; 6 fs.writeChunk calls cost 4,416 ms (~736 ms each), fs.mkdir 856 ms — 74% of product selfTime; probe volume explains only ~0.36 s (16,533 hops × 18 µs + 63 ms handlers), so this is THE dominant term of the product-vs-in-realm gap
user_story: As a dev running `vite build` in the product child, I want dist writes to cost owner-write speed, but today every 256 KiB output chunk runs the owner's full mutation-publication pipeline, so 6 chunk writes eat ~4.4 s of a ~6 s build.
sources: [docs/backlog/perf/reference/child-fs-rpc-hot-path.md, ADR-0150]
code: [packages/workbench/src/workers/workbench-project-vfs.ts, packages/runtime-js/src/ipc/fs-handlers.ts, packages/runtime-js/src/ipc/sync-rpc-fs.ts]
---

## Context

Per-chunk cost is owner-side publication, not transport: each guest write chunk
runs `mutationGuard` → `admitMutation` → `withSemanticReplacements` +
`recordAppliedMutation` + `await publishThroughCurrent(true)`
(`workbench-project-vfs.ts` guard ~:555, applyMutation ~:496) — a full owner
tree publication per 256 KiB chunk. Owner VFS handlers themselves are trivial
(63 ms for 16.5 k calls). Same run: probe latency inflates 5–70× above the
18 µs idle hop while the owner digests publication work, so fixing writes also
deflates the measured 2.1 s stat-latency term. Repro: instrument
`SyncRpcDispatcher.pumpOnce` (per-method count + handler ms) and
`SyncRpcFsSync.callFs*` (child-blocked ms), run
`pnpm bench:child-fs --runs 1 --out /tmp/x.json --port 5411`, read phase dumps.

Distinct from `fs-rpc-chunk-perf` (>256 KiB O(N²) + base64 inflation) — same
file family, different term; binary write bodies (ADR-0366 envelope) compose.

## Challenge

challenge: 2026-08-27 — 7 problems
- sizing — numerator and denominator come from different runs: 4,416 ms was measured in an instrumented run whose `vite build` took 10.75 s, but the title/user_story sell it as "4.4 s of a ~6 s build" (6.03 s is the uninstrumented anchor in `docs/backlog/perf/reference/child-fs-rpc-hot-path.md`); worse, the doc claims to recover 4.4 s of writes *plus* deflate 2.1 s of stat latency = 6.5 s, larger than the entire product-vs-in-realm gap it cites (6.03 s − 1.27 s = 4.76 s).
- premise — "per-chunk cost is owner-side publication" is read off the call chain, never measured: the only owner-side number in the doc is dispatcher handler-ms (63 ms/16.5 k), which stops at the returned promise, so publication, the `writeChunk` prev+concat merge (`packages/runtime-js/src/ipc/fs-handlers.ts:112`), `startPublicationAdmission` queueing behind `withPublicationBarrier`/the pump, and owner event-loop scheduling are all still lumped into one child-blocked wall-time bucket.
- premise — the blamed mechanism is implausibly cheap on this fixture: `rawPublishCurrent` → `collectSnapshot` uses default `SNAPSHOT_EXCLUDE_DIRS = [node_modules, .git, .vite, dist]` (`packages/workbench/src/glue/vfs-snapshot-port.ts:106`), so a dist write publishes a walk of ~9 tiny source entries from `tools/perf/child-fs/scenario.mjs` — nothing there explains 736 ms/chunk, and the doc offers no timing that rules out the alternatives.
- sizing — evidence is a single `--runs 1` instrumented run, in a lane whose own retro (same reference doc, §Direction verdict) recorded that single-run readings already produced one false regression verdict and that spread on unchanged code is ~1.2 s; no dispersion is given for the n=6 per-call values, and `fs.mkdir 856 ms` is quoted with no call count — the one cross-check that would confirm a constant per-publication cost.
- premise — the remedy's ceiling is unstated: "publish once on the final chunk" removes (chunks − files) publications, and the doc never reports how many distinct files the 6 chunks belong to; a vite dist of `index.html` + one css + one js means most of the 6 are single-chunk files that gain exactly zero, so "6 chunk writes eat ~4.4 s" is not the addressable amount.
- direction — the proposed work is already the write half of `docs/backlog/perf/fs-rpc-chunk-perf.md` Route 2 ("write = accumulate chunks, one `writeFileSync` on the final chunk"), on the same handler and carrying the same visibility fork; the draft asserts "distinct term" without naming the overlap, so as written the two drafts schedule duplicate, conflicting edits to `packages/runtime-js/src/ipc/fs-handlers.ts`.
- direction — a cheaper route is not considered: because `dist` is snapshot-excluded, all 6 of these publications emit a byte-identical entries list, so an extraneous-write predicate over excluded dirs — the shape `extraneousTreeMutation` already has for node_modules (ADR-0307, `packages/workbench/src/workers/workbench-project-vfs.ts:519`) — targets the same cost without opening the visibility-vs-durability fork at all.
- ux — the benefiting scenario is sized only by a bench fixture that sets `build: { minify: false }` (`tools/perf/child-fs/scenario.mjs:28`), which inflates dist bytes and therefore the chunk count the whole cost scales with versus a default user `vite build`; and the governing reference doc states "No numeric speedup target was accepted… these single-run browser timings are diagnostic", so the draft names no user-facing threshold the 4.4 s is measured against.

## Options / Next

- Coalesce publication per file: the chunk protocol is already
  truncate-then-append keyed by path/offset; publish once on the final chunk
  (or per write burst) instead of per chunk. Owner stays SSoT; no child cache.
- Open fork to resolve at compile: visibility vs durability — ADR-0150 says
  every op observes latest owner state; coalescing must not delay visibility
  to concurrent readers, only the durable publication. Needs an explicit
  decision on what `publishThroughCurrent(true)` guarantees per chunk today.

## Reversibility

REVERSIBLE — owner-side handler/publication scheduling behind the existing
`fs.*` surface; the visibility fork is the only decision point.
