# Tracker embedder snapshot facts — 2026-09-01

Re-verification of the "Tracker-scale" premise against the real embedder
(tracker4 checkout, `@riftydev/workbench` 0.4.0). Read-only inspection; no
timing was re-run here — timings are quoted from the embedder's own notes.

## Integration

- `@riftydev/{runtime-js,service-worker,workbench}` 0.4.0 from npmjs.
- `storage: { persistence: 'preferred' }`; project `firstMaterialization:
  { kind: 'snapshot' }`, `templateId: 'tracker-plugin'`; the registry URL is
  unreachable by design — no install path exists in the embedder.
- Snapshot asset `static/rifty-snapshots/tracker-plugin.json.gz`, JSON v3,
  pinned `sha256:532d42b7…`, baked by an out-of-repo script against rifty
  `v0.4.0`, pruned (`.map .md .d.ts .d.mts .d.cts .flow .txt LICENSE` —
  6,276 files / 27.6 MB dropped before baking).
- Seed precondition: `/.gitignore` must exist or the git baseline walks
  `node_modules` and exhausts the owner budget.

## Snapshot T (real) vs surrogate S (benchmarks)

| metric | T — tracker-plugin v3 | S — reference benchmarks |
|---|---:|---:|
| packages | 216 | — (issue text: 171) |
| `node_modules` files | 15,568 | 14,492 |
| directories | 1,731 | 2,009 |
| logical content bytes | 73,637,414 | 98,200,000 |
| base64 chars of content | 98,203,932 | — |
| serialized JSON bytes | 104,785,096 | — |
| gzip on disk | 28,480,462 | — |
| bytes / file | 4,730 | 6,776 |
| tarball replay cache | 1 file, 3,821,302 B (lightningcss) | — |
| largest files | `lightningcss_node.wasm` 15,850,559 + `rolldown-binding.wasm32-wasi.wasm` 11,790,262 = 37.5 % of all bytes | — |

98,203,932 / 73,637,414 = 4/3 exactly: the issue's "98.2 MB" was the base64
size. S copied it as content bytes → S over-weights bytes ×1.33 and
under-counts files ×1.07 / packages ×1.26. Byte-linear benchmark results scale
×0.75 on T; file-linear ×1.07.

Commands (run inside the tracker4 checkout):

```text
stat -f '%z %N' static/rifty-snapshots/tracker-plugin.json.gz        → 28480462
python3 -c "import gzip;print(len(gzip.open('static/rifty-snapshots/tracker-plugin.json.gz','rb').read()))"  → 104785096
python3: sha256(raw) == pinned snapshotId; one pass over nodeModules.files: entries, dirs from paths, bytes = len(b64)//4*3 - b64.count('=')
```

## Embedder timings (quoted, not re-run)

- workbench 0.3.0: cold open ≈ 50 s; `#completePromotion` 40.4 s — the
  issue #255/#256 numbers.
- workbench 0.4.0 (mkdir-dedup + ADR-0358 drain): cold `openProject`
  **16.3 s**, still mute, on a tree 7 % larger. Source: tracker4
  `.scratch/plugin-vibe-sandbox/issues/24-workbench-040-upgrade.md:67`.
- Reopen was never timed by the embedder.
- The 16.3 s includes fetch 28.5 MB gz + gunzip + `JSON.parse` of 104.8 MB +
  base64 decode of 98.2 M chars + apply + git baseline + `createProject` + TS
  worker. The drain share on 0.4.0 is unmeasured.

## Projections on T (linear scaling of the reference benchmarks)

| metric | formula | T |
|---|---|---:|
| per-file drain | 15,568 × 7,183.9 ms / 14,492 | 7.72 s |
| per-file reopen | 15,568 × 4,603.7 ms / 14,492 | 4.95 s |
| journal replay | 73.6 MB × 1,142.7 ms / 98.2 MB | 0.86 s |
| journal append | 73.6 MB / 85.5 MB/s | 0.86 s |

Real 0.4.0 cold open = 1.05 ms/file end-to-end vs 0.50 ms/file bench drain.
Measured on main the same day (`tracker-snapshot-open-split-2026-09-01.md`):
drain 11.47 s (0.737 ms/file — this table's 7.72 s is 1.49× optimistic),
reopen 10.03 s (4.95 s here is 2.03× optimistic; `preloadContent` alone is
6.17 s). Storage owns 85.8 % of the cold open and 83.9 % of the reopen.

## Consequences

- Proof substrate for `epics/fast-project-open-reopen` is T's manifest
  (paths + sizes, incl. the two wasm blobs), derived at RED from the real
  asset — not S. The asset itself stays outside this repo (28.5 MB).
- C4's deferred-flush measurement used a 384-file / 47 MB snapshot: its
  readiness finding (early reply ≠ executable) is scale-independent; its
  timing floor is not Tracker scale.
- The encoding / JSON tax on the open path belongs to
  `playground/snapshot-carries-substituted-bytes-twice`, not to the storage
  goal.
