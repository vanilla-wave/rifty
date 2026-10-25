# Storage open/reopen candidate benchmarks — 2026-09-01

> Correction (2026-09-01): the dataset's 98,200,000 bytes reproduced the
> issue's *serialized base64* size; the real tracker-plugin snapshot holds
> 73,637,414 logical bytes in 15,568 files / 216 packages. Byte-linear
> results here scale ×0.75 on the real tree, file-linear ×1.07; details:
> `tracker-embedder-snapshot-facts-2026-09-01.md`.

Evidence for candidate B (per-file content + durable index + lazy hydration),
fresh-process reopen, deferred flush, and real editor-read impact. Disposable
browser-unit spike; code removed after measurement.

## Conditions

- Chromium 148.0.7778.96 / Playwright 1.60.0, headless, COI, real Worker
  OPFS; macOS 26.3.1 arm64. AC connected; battery 99%, reported discharging
  after the run. Browser reports 12 hardware threads / 32 GiB.
- Five samples; median reported. Warm C1/C2/C4/C5: one browser process. C3:
  one persistent profile, fresh Chromium process per sample, mode order
  rotated. OS cache could not be evicted; it remained uncontrolled/warm.
- Exact first-round selection: FNV-1a path rank + at most five best swaps,
  then path sort. 14,492 files, 98,200,000 bytes, 2,009 content dirs. C3 used
  the original namespace; trace SHA-256
  `d9fefede483d8b5cd7c7ba0c11d90a346ebb46e8e6405b59813bbb5935b42dd8`
  and journal size 101,733,780 bytes match the first round.

Commands:

```text
playwright test --config playwright.browser-unit.config.ts storage-round2.spec.ts
playwright test --config playwright.browser-unit.config.ts storage-round2-product.spec.ts
gh issue view 255 --repo vanilla-wave/rifty --json body,comments,updatedAt
gh issue view 256 --repo vanilla-wave/rifty --json body,comments,updatedAt
```

Both disposable specs passed. Product instrumentation and counterfactual
changes were removed before evidence was recorded.

## C1 — lazy first touch

Each fault opened a real `FileSystemSyncAccessHandle`, allocated the content
buffer, synchronously read exact bytes, and retained them like the current
content cache. `cached` memoised directory handles; `uncached` repeated the
full path chain. Burst order was the exact 14,492-file selection.

| burst variant | total samples ms | median ms |
|---|---|---:|
| uncached dirs | 9066.340, 8830.515, 8796.970, 9038.565, 8995.565 | 8995.565 |
| cached dirs | 4468.255, 4224.840, 4469.115, 4423.000, 4362.470 | 4423.000 |
| pre-open all handles, then sync-read | 4087.505, 4260.255, 4209.580, 4312.730, 4086.975 | 4209.580 |

Cached-burst phase medians: directory resolution 221.025 ms; handle open
2071.420 ms; allocation 19.435 ms; sync reads 1496.505 ms. The
sync-compatible variant spent 2612.470 ms pre-opening 14,492 handles and
1578.280 ms reading.

One first touch across five size quantiles: 29.925, 0.510, 0.580, 0.530,
0.485 ms; median 0.530 ms. The first sample carried a 29.5 ms path-resolution
outlier.

`createSyncAccessHandle()` is Promise-valued. Existing synchronous `FsSync`
cannot open a never-seen file during `readFileSync`; without new blocking
machinery it must pre-open handles. All 14,492 handles opened successfully,
but their 2.61 s open cost moves onto reopen.

Decision gate: best lazy burst 4.423 s versus current preload 2.727 s =
**+1.696 s**, above the allowed ~0.5 s. Candidate B fails C1. Including its
31 ms cold index load gives ~4.454 s before a full scan finishes; journal
read+replay is 1.143 s and leaves reads in memory.

## C2 — durable logical index

Measured JSON carrier: 16,502 logical entries = 14,492 files + 2,009 dirs +
root. Files carry path/kind/size/mtime; dirs also carry sorted children.

| operation | samples ms | median ms |
|---|---|---:|
| serialize 1,477,816 bytes | 4.530, 4.295, 4.385, 4.265, 3.605 | 4.295 |
| rebuild/update in-memory index | 10.160, 10.950, 9.960, 10.535, 10.320 | 10.320 |
| publish pending marker + index + committed marker | 18.235, 12.530, 18.050, 13.265, 57.745 | 18.050 |
| valid async load + digest + parse + hydrate | 52.750, 11.120, 11.225, 11.100, 11.130 | 11.130 |

Valid-load median phases: marker 0.550 ms, index read 0.780 ms, SHA-256
5.570 ms, parse 1.885 ms, Map/children hydration 2.305 ms. First validation
paid a 45.7 ms hash/JIT outlier.

Index maintenance belongs at flush publication: measured publish median ×
16,502 structural operations projects to 297.9 s if rewritten after every op,
before content persistence. Rebuilding the full in-memory index once + one
publish is ~28.4 ms.

Honesty probe:

- pending epoch rejected in 0.470 ms;
- corrupted index digest rejected in 5.590 ms;
- pending epoch + full OPFS fallback walk: 1802.165, 2011.475, 1742.685,
  1963.300, 1975.940 ms; median 1963.300 ms;
- an out-of-band OPFS file write left a self-consistent committed
  marker/index valid. Epoch+digest is therefore honest only while the existing
  origin Web Lock plus one-writer contract covers every OPFS mutation. It is
  not a cheap physical-tree verifier against arbitrary same-origin OPFS writes.

## C3 — fresh Chromium reopen

Every sample launched a fresh Chromium process over the seeded persistent
profile. Timers include first OPFS access. Journal read used async
`File.arrayBuffer()`; replay framing/checksums/content hashes are identical to
round one.

| route | phase | samples ms | median ms |
|---|---|---|---:|
| current | open OPFS | 14.980, 15.125, 16.050, 14.995, 14.925 | 14.995 |
| current | walk | 1725.670, 1706.760, 1687.095, 1807.375, 1676.580 | 1706.760 |
| current | preload | 2863.050, 2845.270, 3037.400, 2888.270, 2750.385 | 2863.050 |
| current | total | 4603.720, 4567.180, 4740.555, 4710.660, 4441.910 | 4603.720 |
| index | total valid load | 31.000, 31.725, 33.620, 30.475, 30.025 | 31.000 |
| journal | async read | 42.005, 44.250, 49.020, 44.290, 42.505 | 44.250 |
| journal | replay | 1089.460, 1123.955, 1107.930, 1075.065, 1100.200 | 1100.200 |
| journal | total | 1131.475, 1168.215, 1156.965, 1119.370, 1142.720 | 1142.720 |

Index cold median phases: first marker/OPFS 15.580 ms; index read 0.725 ms;
SHA-256 8.700 ms; parse 2.540 ms; hydrate 3.085 ms.

No inversion versus warm round one: current 4.604 s versus 4.913 s (-6.3%);
journal 1.143 s versus 1.084 s (+5.4%). Journal remains ~4.0× below current.
Index-only metadata reopen is 31 ms, but C1's full synchronous scan shrinks
its gain over current to ~0.15 s.

## C4 — deferred flush

Real shipped TypeScript snapshot: 19,323,110-byte gzip, 68,118,176-byte
serialized payload, 384 node_modules files / 47,212,791 logical bytes.

Standalone real snapshot path in the browser worker:

| phase | samples ms | median ms |
|---|---|---:|
| fetch + gunzip + parse | 139.960, 135.985, 141.705, 142.645, 141.045 | 141.045 |
| validate/base64 prepare | 110.295, 101.445, 99.490, 261.415, 97.745 | 101.445 |
| apply to Memory VFS | 1.055, 0.830, 0.685, 0.640, 0.650 | 0.685 |
| total | 251.360, 238.285, 241.895, 404.715, 239.460 | 241.895 |

Real Workbench first-open, OPFS reset before every sample:

| phase | samples ms | median ms |
|---|---|---:|
| Workbench boot | 200.600, 182.260, 183.890, 182.320, 184.585 | 183.890 |
| catalog create | 39.410, 36.085, 36.985, 33.415, 37.015 | 36.985 |
| `openProject` | 696.140, 682.315, 692.160, 687.580, 672.640 | 687.580 |
| whole session-ready | 937.775, 901.145, 913.455, 903.725, 894.915 | 903.725 |
| snapshot apply inside owner | 23.550, 25.510, 25.585, 22.755, 24.415 | 24.415 |
| promotion/flush | 344.440, 335.955, 338.585, 339.605, 335.620 | 338.585 |

Making only `#completePromotion` background changed `openProject` median to
672.125 ms and whole readiness to 886.085 ms: promotion already overlaps
post-acquisition project setup and finishes at about the reply. A disposable
2 s scheduling hold before background promotion left `openProject` at
658.550 ms and returned with 1.662 s of the injected hold remaining. This is
mechanism proof, not a real window duration: a long drain can be moved off the
reply, but fetch/prepare/project setup remain.

That early reply was not a ready Node session. During the injected window,
immediate `node -e` settled in 2.150 ms with exit 1 and
`package tree readiness is not published`; after promotion, the same command
settled in 848.785 ms with exit 0 and expected output. Existing package-tree
admission deliberately publishes only after the trusted stamp. Plain deferred
promotion therefore moves the reply but not executable readiness; changing
that requires a new pending-ready contract/mechanism.

Owner killed median 1 ms after that early reply; all five reloads applied the
snapshot again. Recovery `openProject` samples: 674.610, 652.475, 669.720,
670.895, 671.605 ms; median 670.895 ms. Whole reload-to-session samples:
1726.210, 1648.015, 1654.040, 1661.890, 1658.950 ms; median 1658.950 ms.
Thus a kill in the window takes the honest cold restore path, never trusts the
torn tree.

The real Tracker operation trace/snapshot remains unavailable: read-only
inspection of current issues #255/#256 found aggregate phases and no attached
operation artifact. Issue #256's original cold measurement gives the missing
scale warning: fetch/parse 0.3 s + plan 0.5 s + apply 0.4 s + createProject
0.1 s before/after its old 40.4 s flush. Deferred readiness on that workload
was never a 56 ms proposition; its observed non-flush floor was ~1.3 s.

## C5 — editor action share

Five real `ProjectDocument.open()` actions on distinct TypeScript source files,
over an owner tree with 521 entries / 51,116,165 content bytes:

| phase | samples ms | median ms |
|---|---|---:|
| whole document open | 5.830, 5.240, 11.180, 4.305, 4.610 | 5.240 |
| `OwnerVfsAuthority.snapshot()` | 4.685, 4.060, 8.955, 3.950, 4.320 | 4.320 |

Full-tree snapshot is **82.4%** of the median real editor admission action. The
absolute cost is smaller than B0's 46.5 ms because this tree has 521 entries
and 51.1 MB, not 14,492 files / 98.2 MB. The amplification is material in the
actual user action, not only an internal microbenchmark.

## Decision evidence

- Candidate B fails the decisive burst gate: lazy faults add 1.696 s over
  current preload; even eager pre-open + reads add 1.483 s. It also has a
  Promise-valued handle-open incompatibility with synchronous FsSync.
- Its durable index is cheap and useful evidence (1.48 MB; 11 ms warm / 31 ms
  fresh-process load), but cannot replace journal replay for Node build/scan
  workloads and is not a physical-tree verifier outside one-writer control.
- Fresh-process proportions do not reverse round one: journal 1.143 s versus
  current 4.604 s.
- Plain deferred promotion cannot hide the tail from usable Node readiness:
  the early session rejects execution until trusted package-tree publication.
  It also leaves fetch/prepare/project setup and a cold-restore crash window,
  so it does not remove the journal's first-persist or burst-reopen case.
- Targeted page reads are independently high priority: full-tree snapshot is
  82.4% of a real document-open action.
