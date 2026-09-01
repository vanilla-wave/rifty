# Storage replica design benchmarks — 2026-08-31

> Correction (2026-09-01): the dataset's 98,200,000 bytes reproduced the
> issue's *serialized base64* size; the real tracker-plugin snapshot holds
> 73,637,414 logical bytes in 15,568 files / 216 packages. Byte-linear
> results here scale ×0.75 on the real tree, file-linear ×1.07; details:
> `tracker-embedder-snapshot-facts-2026-09-01.md`.

Evidence for changing the OPFS replica format. Disposable browser-unit spike;
code removed after measurement.

## Conditions

- Chromium 148.0.7778.96, headless, COI, real Worker OPFS.
- macOS 26.3.1, arm64 T6030, 12 hardware threads, 32 GiB reported;
  battery full + charging.
- Five samples; median reported. One browser process. Reopen = fresh VFS
  instance over warm same-process OPFS, not browser/OS cold cache.
- Dataset: 14,492 paths selected deterministically from committed
  `real-tree-manifest.json`; swaps preserve real path/size pairs and make total
  exactly 98,200,000 bytes. 2,009 content dirs. This matches issue #255/#256
  cardinality + bytes, but is not the unavailable 171-package Tracker trace.

Commands:

```text
pnpm test:browser-unit storage-design-b0.spec.ts
pnpm test:browser-unit storage-design-bench.spec.ts
```

Both passed. Specs were disposable per `decision-workflow.md` §Refine altitude.

## B0 — page read amplification

Code path verified:

- `workbench-project-vfs.ts` page read-file/read-directory calls
  `authority.snapshot()`.
- `OwnerVfsAuthority.snapshot()` visits every tracked path;
  `#snapshotEntry()` slices every file's bytes.

| operation | samples ms | median ms |
|---|---|---:|
| direct authority target read | 0.010, 0.010, 0.005, 0.005, 0.010 | 0.010 |
| page read-file request | 46.545, 48.110, 48.125, 45.175, 46.110 | 46.545 |

One target read is ~4,655× the direct path and copies the 98.2 MB tree.
`#assignSubtree` on the in-memory tree was 32.83 ms. Separate defect; unrelated
to OPFS format.

## B1 — reopen phases

| phase | samples ms | median ms | share of total |
|---|---|---:|---:|
| `refreshIndex` / `walkOpfsTree` | 2278.595, 2150.790, 1835.120, 2137.285, 1774.805 | 2137.285 | 43.5% |
| `preloadContent` | 2694.220, 3044.435, 2716.480, 2755.845, 2727.065 | 2727.065 | 55.5% |
| owner `#assignSubtree('/')` | 25.180, 19.305, 18.995, 20.205, 23.265 | 20.205 | 0.4% |
| total | 4998.005, 5214.535, 4570.605, 4913.335, 4525.140 | 4913.335 | 100% |

Phase 3 is negligible. Storage enumeration + per-file preload own ~99%.

## B2/B3 — traced content-addressed mini-journal

Current drain trace: 16,502 real scheduler operations = 14,492 writes + 2,010
mkdirs; 26,361 path references. SHA-256 trace digest:
`d9fefede483d8b5cd7c7ba0c11d90a346ebb46e8e6405b59813bbb5935b42dd8`.

Disposable frame carried all `PersistOperation.paths`, kind, mode, mtime,
SHA-256 content address, CRC32, content. One long-lived
`FileSystemSyncAccessHandle`; one final flush. Replay rebuilt content-addressed
blocks, path map, full children index, and times map; verified every CRC and
SHA-256.

| append chunk | samples ms | median ms | logical MB/s |
|---|---|---:|---:|
| 1 MiB | 1192.875, 1171.710, 1161.610, 1213.965, 1154.755 | 1171.710 | 83.81 |
| 4 MiB | 1143.840, 1143.205, 1156.875, 1148.590, 1152.075 | 1148.590 | 85.50 |
| 16 MiB | 1151.430, 1156.505, 1146.245, 1154.410, 1154.205 | 1154.205 | 85.08 |

Physical journal: 101,733,780 bytes. 4 MiB result:

| phase | samples ms | median ms |
|---|---|---:|
| sequential read | 20.025, 19.525, 18.665, 19.585, 18.905 | 19.525 |
| validated CAS replay | 1080.105, 1064.140, 1054.025, 1077.875, 1058.315 | 1064.140 |

Replay proof: 14,492 files, 2,011 dirs including `/`, 13,892 distinct
procedural-content blocks, 16,502 verified frames. Read + replay = 1.084 s,
4.53× below current 4.913 s reopen. The block count is integrity proof, not a
real-package dedup estimate: payload bytes were procedural.

## B4 — current per-file drain

Apply med 56.085 ms. Real OPFS drain samples: 7260.200, 7183.915, 7147.880,
6875.495, 7196.820 ms; median 7183.915 ms. Every run: watermark 16,502,
failure-ledger total 0. The 4 MiB journal append is 6.25× faster.

## B5 — synchronous lockfile SHA-256

| bytes | samples ms | median ms |
|---:|---|---:|
| 500,000 | 1.805, 1.795, 1.810, 1.815, 1.835 | 1.810 |
| 1,000,000 | 3.580, 3.605, 3.625, 3.590, 3.585 | 3.590 |
| 3,000,000 | 10.760, 10.825, 10.785, 10.775, 10.735 | 10.775 |

Not an open/reopen suspect at expected lockfile sizes.

## B6 — memory front

CDP `Runtime.getHeapUsage` after `HeapProfiler.collectGarbage`, same dedicated
Worker before/after `OpfsFsSync.init` + one time entry per file:

| component | delta bytes |
|---|---:|
| JS heap used | 6,040,876 |
| embedder heap used | 963,808 |
| backing storage | 98,335,264 |
| total measured footprint | 105,339,948 |

Current front costs ~105.3 MB for 98.2 MB logical bytes: ~1.073×. N live
independent fronts therefore remain RAM-linear even if disk replay becomes
fast.

## Decision evidence

- Append gate passes: 85.5 MB/s > 50 MB/s.
- Journal/segment design is worth pursuing: it addresses both 7.18 s first
  persistence and 4.91 s reopen; projected validated replay is 1.08 s.
- `#assignSubtree` does not block the design: 20.2 ms / 0.4%.
- Lazy preload remains a cheaper sibling lever, but alone cannot remove the
  2.14 s OPFS walk or the 7.18 s per-file first persist.
- Remaining probes before a storage-format ADR: actual Tracker operation trace;
  cold browser/OS reopen; crash/truncation, quota, compaction, migration, and
  cross-tab-writer fault rows.
