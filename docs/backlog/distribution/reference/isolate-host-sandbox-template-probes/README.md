# Template-layer probes (goal `isolate-host-sandbox-template`)

Disposable probes for the template goal's forks. `packages/*/src` untouched; the probe guest
bundle is the real guest entry + `probe-guest.ts`, built by `layer.mjs` into a temp file.
Machine: Apple M3 Pro, macOS, Node v24.16.0, isolated-vm 7.0.2, main @ `b3731e9c0`, load ~4–5.
Raw output: `mount.out.txt`, `layer.out.txt`.

## M — mount point (`mount.mjs`)

Same tree in a sandbox (built `@riftydev/isolate-host`, host `writeFile` at absolute paths) and in
real `node main.js` over a temp dir read as `/`. Cases: `main` field (with a decoy `index.js`), hoisted
dependency, nested `node_modules` shadowing a hoisted copy, `exports` `require` condition, `exports`
subpath, missing module, `module.paths`.

| template at | rifty = Node | `module.paths` (both) |
|---|---|---|
| `/node_modules` | yes, every case | `/workspace/node_modules`, `/node_modules` |
| `/workspace/node_modules` | yes, every case | same |

Both mounts resolve as Node does; the choice is not forced by the loader.

## L — how a fresh isolate sees the template (`layer.mjs`)

Worker side only (fresh isolate per run, guest bundle from a V8 code cache, as `child/main.ts`).
Templates: T1 = `semver@7.7.2` + real files from the pnpm store, 296 files / 1.0 MB;
T95 = `pdf-lib@1.17.1` (+ deps) + `semver` + store files, 23 654 files / 88.8 MB (the
requirements' 23 654 files; bytes ~7 % under 95 MB). Workloads: `semver` (require + one write),
`pdf` (pdf-lib, one-page PDF), `many` (1 000 × 1 KiB writes + readdir + read back).
Arms:

- `full` — today: template inside the state; restore(template ∪ diff) → run → snapshot of all.
- `views` — cheapest in-heap materialization: one ivm copy of a packed buffer, every file a view
  into it (no per-file copy); capture walks the tree, snapshots non-template files.
- `lazy` — isolate holds only the diff; template read on demand via 3 sync host functions
  (stat / read / readdir) over an immutable worker-side Map (overlay in the guest realm).
- `worker` — the worker owns the whole FS (template + diff, rifty's MemoryFs in the worker realm);
  every guest FsSync call is one sync host call; the end state is the worker's own snapshot.

Medians of 7 (ms, worker side: isolate boot + restore + run + capture); floor = smallest
`memoryLimit` (MiB) at which the run succeeds (bisection, step 4).

| arm | T1 semver | T95 semver | T95 pdf | T95 many | floor T1 / T95 |
|---|---|---|---|---|---|
| full | 73.9 | 419 | 676 | 367 | 19 / 215–219 |
| views | 72.7 | 198 | 466 | 167 | 19 / 123 |
| lazy | 87.4 | 80.5 | 432 | 36.7 | 19 / 19–23 |
| worker | 85.1 | 77.8 | 404 | 51.4 | 19 / 19–23 |

- `full` also pays the consumer's encode + decode of the whole state per `exec`: T95 151 + 178 ms
  (T1 3 + 3); the other arms move only the diff (527 B – 1.1 MB here).
- `views`: materializing T95 is 94 ms and the capture walk 39 ms per run — linear in the template
  even with zero per-file copies; +100 MiB of isolate memory.
- `lazy` / `worker`: same numbers on T1 and T95 for the same workload — independent of the
  template's size. Cost per bridge call ≈ 14 µs: pdf-lib's `require` makes ~6 200 stats and 915
  reads (7.1 MB) → +100 ms run time against `views` (no guest-side cache in the probe).
- `worker` pays a crossing per write too: `many` 51 vs 37 ms (2 018 calls).
- Concurrency, 4 runs at once in one process (a worker's 4 slots; sync host calls share its main
  thread), T95, wall ms: pdf — full 1 053, views 729, lazy 787, worker 684; many — full 503,
  views 213, lazy 45, worker 81.

Not probed (implementation facts, not choices): a guest-side cache of template stats/bytes;
`fs.readSync` reads the whole file per call (`runtime-js/src/builtins/fs.ts` `readSync` →
`readFileBytesSync`), so through a bridge a chunked read of a large file copies it once per chunk
unless the guest caches it; the probe overlay is partial (no whiteouts, no cross-layer rename).
