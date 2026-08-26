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
