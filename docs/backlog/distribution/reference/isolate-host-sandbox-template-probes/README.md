# Template-layer probes (goal `isolate-host-sandbox-template`)

Disposable probes for the template goal's forks. `packages/*/src` untouched; the probe guest
bundle is the real guest entry + `probe-guest.ts`, built by `layer.mjs` into a temp file.
Machine: Apple M3 Pro, macOS, Node v24.16.0, isolated-vm 7.0.2, main @ `b3731e9c0`, load ~4–5.
Raw output: `mount.out.txt`, `layer.out.txt`, `layer-layered.out.txt`, `host.out.txt`, `seq.out.txt`,
`gen.out.txt`, `gens.out.txt`. `layer.mjs` drives isolated-vm and rifty's codec from source, not the public API: worker-side costs of each arm, not a consumer's `exec`.

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

## H — the consumer's side: host ops and an idle sandbox (`host.mjs`, `host.out.txt`)

Same T1/T95 builders over the pnpm store at main @ 57152054d (T95's filler bytes moved with the
store: 23 654 files, 72.5 MB here vs 88.8 MB in L). rifty's MemoryFsSync + codec from source.
Medians of 21 (ms); «after touch» = a write after `list` of `/node_modules` and of every package;
idle = heap + ArrayBuffers per sandbox over 20 held sandboxes, one 10 KiB own file each. Load ~7–13.

| arm | create T1 / T95 | `writeFile` 10 KiB + cap check T1 / T95 | write a template file T1 / T95 | write after touch T1 / T95 | idle T1 / T95 |
|---|---|---|---|---|---|
| views (a `MemoryFsSync` of views per sandbox, cap check walks it) | 1.88 / 98.8 | 0.63 / 31.1 | 0.65 / 30.5 | 0.88 / 31.1 | 111 KiB / 9.3 MiB |
| overlay (hand-written: difference + deleted set; rejected, ADR-0572 §2) | 0.06 / 0.01 | 0.17 / 0.15 | 0.30 / 0.29 | 0.42 / 0.42 | noise (−3 KiB / −480 KiB) |
| layered (`layered.ts`, budget kept per operation) | 0.31 / 0.05 | 0.07 / 0.05 | 0.02 / 0.02 | 0.05 / 0.05 | 4 KiB / 3 KiB |

`readFile`, `list('/node_modules')`, `remove` ≤ 0.04 ms in every arm. Requirements §3: «Хостовая
запись стоит O(размер записи + дифф), а не O(всего состояния)», «Память простаивающей песочницы у
потребителя не включает шаблон: N песочниц на одном шаблоне держат одну его копию» — `layered`
meets both, also after the host touched the whole template; `views` does not.

## S — named sequences against live Node (`layered.ts`, `seq.mjs`, `seq.out.txt`)

`layered.ts` (probe prototype of ADR-0572 §2, second construction): rifty's `MemoryFsSync`, template
entries entering it lazily by node — a directory as a node with a marker, a file as a node holding
the template's bytes reference with an origin — every call then on the `MemoryFsSync` unchanged;
the state is every node held, described by identity (`lazy` / `ref` / explicit), rebuilt node for
node. (`layered-v1.ts`, the first construction, derived a difference from path existence and
times; review N2 and probe G show where it breaks.) `seq.mjs` runs each sequence against live
`node` v24.16.0 over a real temp directory holding the same template (times set) and program: in
a fresh isolate (rifty `fs` → the layered class, state captured there, rebuilt by the consumer),
as host ops in the consumer, host ops → a run → the host, two runs in a row. Compared: each call's
error code, the final tree (kind, size, sha1, file mtime as «template era» or «now»), the
changed-paths list vs a walk of Node's before/after, the consumer's wire round trip. Directory times
are compared by probe G, not here.

Result: **29/29**, exit 0 (1 on any FAIL): the 23 rows of the first table (remove → write the same
path; remove a directory → write a child, with and without `mkdir`; `rmdir` + `mkdir`; `rename` of
a template directory then `require` from it; a template file moved out, a file moved in; a rename
onto a non-empty directory; `utimes`; a same-bytes overwrite; `EISDIR`; `EEXIST`; a non-recursive
`rm` of a non-empty directory; a copy out; host and host → run → host rows; two runs in a row;
reading template files puts no template bytes in the state) and review N2's: a template directory
renamed then recreated, a template file turned into a directory with a child, a template directory
turned into a file, B → A after A → C, a rename onto an existing template file, a recursive copy
merging into a template directory.

## G — generated sequences (`gen.mjs`, `gen.out.txt`)

A seeded generator (`mulberry32`, seeds 1..3 000) builds 4–13-call sequences of `mkdir`
(recursive or not), write, `rm` (recursive, forced or not), `rename`, `cpSync` (recursive),
`copyFileSync`, `utimes`, read and `readdir` over a 6-file template plus new paths. Each runs on
rifty's flat `MemoryFsSync` holding the same files (no layer), on each construction (its state then
carried over the wire and rebuilt on a fresh view), and on `node:fs` over a real directory. A
failure prints its seed and a greedily minimized sequence. Directory and file times compared
(«template era» or «now»).

| | layer ≠ rifty without a layer (calls or rebuilt tree) | rebuilt ≠ Node where rifty without a layer = Node |
|---|---|---|
| `layered-v1.ts` (existence-derived) | **302 / 3 000** — first: seed 4, minimized to one `rename('/node_modules/a', '/node_modules/c')` (the renamed directory's time) | 0 / 3 000 |
| `layered.ts` (node identity) | **0 / 3 000** | 0 / 3 000 |

Guest sample (seeds 10 001..10 060, rifty `fs` in a fresh isolate over `layered.ts`, vs the same
files without a template in a fresh isolate, vs `node` running the same program): layer = no layer
60 / 60; equal to Node 28 / 60; the 32 others differ from Node without a template too (rifty `fs`
itself: `copyFileSync` of a directory `EISDIR` vs `ENOTSUP`, `cpSync` codes, `renameSync` codes and
two silent successes, times — recorded: `backlog/runtime-js/fs-generated-sequence-divergences-from-node`).
The shared template bytes hash the same after all runs. Exit 0 only if `layered.ts` is clean on
all three counts and the bytes are intact.

## F — the F1 return condition's metric on real programs (`gens.mjs`, `gens.out.txt`)

The four libraries' canonical generators (`../isolate-library-probe/gen/{pdf,docx,pptx,xlsx}.cjs`)
over the four-library `node_modules` (npm ci of `../isolate-library-probe/deps`: 8 000 files,
86.6 MB) in a fresh isolate: `layered` (template copy + index + run + capture) vs `state` (the same
files in the sandbox's state, its run phase only), medians of 7, ms. Machine load 9–18 on 12
cores — two runs:

| | empty | pdf | docx | pptx | xlsx | 4 at once pdf / xlsx |
|---|---|---|---|---|---|---|
| run 1 (`gens.out.txt`) | +18 | +29 | +17 | −65 (noise) | +32 | 370 vs 311 / 622 vs 613 |
| run 2 (`gens-2.out.txt`) | +18 | +16 | +9 | +33 | +240 | 466 vs 653 / 773 vs 917 |

Smallest passing `memoryLimit`, empty file: 103 MiB over the template vs 190 with the files in the
state (an empty sandbox without a template: 19 MiB). Too noisy at this load to settle the return
condition; the carrier measures it on an idle machine.

`layer-layered.out.txt` (T95, `views` vs `layered`, the second construction, load 30–40): semver 349
vs 142 ms, pdf-lib 455 vs 377, 1 000 writes 328 vs 182, floor 107 vs 99–103 MiB; four pdf-lib runs
at once 1 039 vs 798 ms wall. The `stream` workload: `full`/`views` keep rifty's async `Vfs` beside
the sync mirror and their read stream comes back empty (the gap PR #437 closes; their end states lack
`app.bin`); the sync-only arms (`lazy`, `worker`, `layered`) write both files as Node.

Not probed:
- a guest-side cache of template stats/bytes (`lazy`); a worker's RSS while it holds templates (the
  pool retires an idle worker above 256 MiB, README);
- the `lazy`/`worker` overlays are partial (no deletion marks, no cross-layer rename); H's `overlay`
  arm covers the four host ops only (kept for numbers; rejected, ADR-0572 §2);
- arm `views` restores the difference before materializing (ADR-0572 §3 applies it after), so a
  difference shadowing template paths was not exercised; its `captureDiff` recognises template
  files by view identity only and emits no deletions;
- the read-only (`EROFS`) mode; decoding the artifact (gzip/br, tar) and sending it to a worker;
- the generator over a large template (G runs a 6-file one); the read-only mode's refusal table;
- the real four-library template (the library probe ran it in the state, not as a template).
