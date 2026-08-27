# Child fs sync-RPC hot path — completed evidence

Closed 2026-08-26. The COI owner→kernel-child path now has the enumerated
minimum wire shape without a cache or owner bypass:

- a read smaller than `FS_RPC_CHUNK` uses one `fs.readFileHead` round-trip
  (ADR-0365);
- `exists`, `stat`, `statOrNull`, `readFileHead`, and `readChunk` use SyncRpc v5
  binary request bodies (ADR-0366);
- readdir and mutations stay JSON; every operation observes the latest owner
  state (ADR-0150).

No numeric speedup target was accepted: these single-run browser timings are
diagnostic, while the exact wire shape and Node behavior gate correctness.

| checkpoint | implementation | product Vite / Express | in-realm Vite / Express |
|---|---|---|---|
| baseline | `c7e19f249e6ae6131449048b6bee050f10372fb0` | 6.03 s / 277.235 ms | 1.27 s / 198.940 ms |
| one-hop reads | `f72ec428a3a646df3804bfabedd02f1564051739` | 6.08 s / 264.695 ms | 1.22 s / 179.180 ms |
| binary requests | `453517d4532f70cf8e58b38a66ae8e3c913560a1` | 7.21 s / 292.865 ms | 1.50 s / 168.795 ms |

## Direction verdict (2026-08-27 retro)

Noise-indistinguishable, not a regression. Interleaved A/B on an idle machine
(4+4 samples, pre `f72ec428a` vs post `453517d45`): product vite median
pre 6.55 s [5.96–7.11] vs post 6.03 s [5.98–6.21] — post never exceeded
6.21 s, while pre itself produced 7.11 s (and in-realm pre produced 1.54 s).
Single-run spread on unchanged code (1.15 s) equals the apparent 6.08→7.21
delta; any runs=1 delta under ~1.2 s on this lane is unresolvable. Matches
micro numbers: binary requests are 0.3–0.6 µs/hop FASTER × ~16.5 k build hops
≈ ≤10 ms. Net wire-shape effect on the anchors: ≤ tens of ms — the remaining
product-vs-in-realm gap is write publication + owner-busy probe latency
(`child-fs-write-publication-coalescing`), not hop count or framing.

## Open-questions disposition (map fog lines, 2026-08-27 retro)

- Unattributed ~7 µs/hop → ANSWERED: Atomics wake latency 6.4–6.5 µs of a
  ~10 µs hop (reply-direction unpark 4.5 + owner event-loop task 2.0); ring
  state machine 0.4 µs, version checks ~0.02, small-payload SAB copies ~0.04 —
  negligible; JSON framing measured 1.7 µs (spike's 3.1 µs not corroborated).
  Lever carrier: `syncrpc-spin-before-park`.
- Batched probe RPC → DECLINED: instrumented product build = 6.5 probes per
  module resolve, batching ceiling ~0.22 s at idle-hop cost; the gap lives in
  write publication, and 60% of `fs.stat` calls are repeated paths — a
  child-side memo stays blocked on ADR-0150 (declined-concepts row).
- Loaded-owner effect → OPEN, carrier `child-fs-loaded-owner`: owner is the
  dedicated workbench-owner Worker (page load irrelevant — settled negative);
  sensitivity is code-determined (+up to T ms/hop per T-ms owner macrotask);
  rig extension drafted, promotion trigger recorded there.

Durable raw carriers:

- `perf/child-fs-baseline.json`
- `perf/child-fs-after-single-hop.json`
- `perf/child-fs-after-binary-requests.json`

## End-to-end proof

- Rig, raw parsing, strict admission and atomic publication:
  `tools/perf/src/child-fs-artifact.test.ts`,
  `tools/perf/src/child-fs-runner.test.ts`,
  `tools/perf/src/child-fs-orchestrator{,.fault}.test.ts`.
- Real product and comparison lanes:
  `tests/browser-unit/child-fs-product-lane{,.fault}.spec.ts` and
  `tests/browser-unit/child-fs-in-realm-lane{,.fault}.spec.ts`.
- One-hop reads and transported Node errors:
  `packages/runtime-js/src/ipc/sync-rpc-fs-single-hop{,.fault}.test.ts` and
  `tests/browser-unit/child-fs-transport-errors.fault.spec.ts`.
- Binary wire, dispatcher, five FS routes, consumers and real Worker:
  `packages/kernel/src/ipc/sync-rpc-binary-request.test.ts`,
  `packages/kernel/src/ipc/sync-dispatch-binary-request.test.ts`,
  `packages/runtime-js/src/ipc/sync-rpc-fs-binary-request.test.ts`, and
  `tests/conformance/kernel/sync-rpc.test.ts`.

## Ledger disposition

The full checkpoint chronology is retained in git at
`61e44b5d8:docs/backlog/epics/child-fs-rpc-hot-path/ledger.md`. Its lines close
as follows:

- expected-RED bands, blocker attempts, splits, ready verdicts and Final+GREEN
  attempts are dropped as transient review state; the behavioral carriers
  above supersede them and both unit and goal residuals are empty;
- all baseline/post-I1/post-I2 timing and identity lines are carried byte-exact
  by the three artifacts and summarized in the table above;
- strict localhost admission/atomic publication, CSI display parsing,
  `finish→finished` Worker settlement, bounded orchestrator cleanup,
  transported `VfsError`, owned SAB copies, and shared client forensics remain
  pinned by the cited owner/fault suites;
- pickup/re-chart/invalidated-item lines are dropped because the map is empty
  and the completed item contracts were deleted.

Large-file O(N²) reads/writes and binary write bodies remain explicitly in
`docs/backlog/perf/fs-rpc-chunk-perf.md`. Child-side caches and owner-RPC bypass
remain declined absent a new ADR with freshness evidence.
