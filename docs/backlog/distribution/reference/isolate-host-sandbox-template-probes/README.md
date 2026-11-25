# Template-layer probes (goal `isolate-host-sandbox-template`)

Disposable probes for the template goal's forks. `packages/*/src` untouched; the probe guest
bundle is the real guest entry + `probe-guest.ts`, built by `layer.mjs` into a temp file.
Machine: Apple M3 Pro, macOS, Node v24.16.0, isolated-vm 7.0.2, main @ `b3731e9c0`, load ~4–5.
Raw output: `mount.out.txt`, `layer.out.txt`. `layer.mjs` drives isolated-vm and rifty's codec from source, not the public API: worker-side costs of each arm, not a consumer's `exec`.

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
`pdf` (pdf-lib, one-page PDF), `many` (1 000 × 1 KiB writes + readdir + read back), T1 only: `stream` (8 MiB through a write stream in 64 KiB chunks, read back by a read stream, then 128 `appendFileSync` of 64 KiB), `bigdiff` (a 16 MiB input in the difference, only stat-ed).
Arms:

- `full` — today: template inside the state; restore(template ∪ diff) → run → snapshot of all.
- `views` — cheapest in-heap materialization: one ivm copy of a packed buffer, every file a view
  into it (no per-file copy); capture walks the tree, snapshots non-template files.
- `lazy` — isolate holds only the diff; template read on demand via 3 sync host functions
  (stat / read / readdir) over an immutable worker-side Map (overlay in the guest realm).
- `worker` — the worker owns the whole FS (template + diff, rifty's MemoryFs in the worker realm);
  every guest FsSync call is one sync host call; the end state is the worker's own snapshot.

Medians of 7 (ms, worker side: isolate boot + restore + run + capture; the `worker` arm's own
restore of the difference inside the window); floor = smallest `memoryLimit` (MiB) at which the
run succeeds (bisection, step 4). Final run (`layer.out.txt`); an earlier run on the same code
differed by ≤ 10 % per row.

| arm | T1 semver | T95 semver | T95 pdf | T95 many | T1 stream | T1 bigdiff | floor T95 pdf / T1 bigdiff |
|---|---|---|---|---|---|---|---|
| full | 69.9 | 392 | 647 | 359 | 54.6 | 48.3 | 219 / 51 |
| views | 66.3 | 190 | 454 | 157 | 47.5 | 44.3 | 123 / 51 |
| lazy | 77.5 | 79.8 | 406 | 33.9 | 63.6 | 39.5 | 23 / 47 |
| worker | 75.3 | 76.7 | 393 | 51.0 | **259** | 51.8 | 23 / 19 |

- `full` also pays the consumer's encode + decode of the whole state per `exec`: T95 ~150 + ~170 ms
  (T1 3 + 3); the other arms move only the difference.
- `views`: materializing T95 is ~90 ms and the capture walk ~37 ms per run — linear in the template
  even with zero per-file copies; +100 MiB of isolate memory.
- `lazy` / `worker`: the same on T1 and T95 for the same workload — independent of the template's
  size. A bridge call ≈ 14 µs: pdf-lib's `require` makes ~6 200 stats and 915 reads (7.1 MB).
- `worker` × chunked I/O on the agent's own files: `stream` 259 ms against 64, **541 MB copied
  across the bridge for two 8 MiB files** — runtime-js's fd layer reads (and for a write rewrites)
  the whole file per chunk (`fs.ts` `readSync` / `writeBytesAt`); in the guest realm that is a
  memcpy, across the bridge a copy per chunk, quadratic in the file. Not fixable in the bridge
  alone: needs ranged FS operations (`FsSync` has none) or a guest-side cache of the agent's files
  (guest-held state again).
- `worker` keeps the agent's files out of the isolate: `bigdiff` floor 19 MiB vs 47–51.
- Four runs at once in one process (a worker's 4 slots; sync host calls share its main thread),
  T95, wall ms: pdf — full 801, views 570, lazy 528, worker 507; many — full 443, views 190,
  lazy 41, worker 78. The probe's main thread does nothing else (no frame parsing, no template
  decode on arrival).

## H — the consumer's side: host ops and an idle sandbox (`host.mjs`)

Same T1/T95 builders over the pnpm store at main @ 57152054d (T95's filler bytes moved with the
store: 23 654 files, 72.5 MB here vs 88.8 MB in L). rifty's MemoryFsSync + codec from source;
the sandbox logic is the probe's. Medians of 21 (ms); idle = heap + ArrayBuffers per sandbox over 20
held sandboxes, one 10 KiB own file each. Load average ~12 on 12 cores.

| arm | create T1 / T95 | `writeFile` 10 KiB + cap check | write a template file | idle per sandbox T1 / T95 |
|---|---|---|---|---|
| views (a `MemoryFsSync` of views per sandbox, cap check walks it) | 1.9 / 97 ms | T1 1.1, T95 30.3 | T1 1.3, T95 31.1 | 112 KiB / 9.4 MiB |
| overlay (one shared index; a sandbox = its difference + deleted paths) | 0.15 / 0.01 ms | T1 0.20, T95 0.16 | T1 0.34, T95 0.30 | ≈ 0 / ≈ 0 (noise, ±0.5 MiB) |

`readFile`, `list('/node_modules')`, `remove` < 0.01 ms in both. The overlay meets requirements
§3's «O(размер записи + дифф)» and «память простаивающей песочницы … не включает шаблон»; the
per-sandbox views tree does not (ADR-0572 §2).

Not probed:
- a guest-side cache of template stats/bytes (`lazy`); a worker's RSS while it holds templates (the
  pool retires an idle worker above 256 MiB, README);
- the `lazy`/`worker` overlays are partial (no deletion marks, no cross-layer rename); H's overlay
  covers the four host ops only;
- arm `views` restores the difference before materializing (ADR-0572 §3 applies it after), so a
  difference shadowing template paths was not exercised; its `captureDiff` recognises template
  files by view identity only and emits no deletions;
- the read-only (`EROFS`) wrapper; decoding the artifact (gzip/br, tar) and sending it to a worker;
- the real four-library template (the library probe ran it in the state, not as a template).
