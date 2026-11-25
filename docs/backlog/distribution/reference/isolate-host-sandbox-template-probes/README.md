# Template-layer probes (goal `isolate-host-sandbox-template`)

Disposable probes for the template goal's forks. `packages/*/src` untouched; the probe guest
bundle is the real guest entry + `probe-guest.ts`, built by `layer.mjs` into a temp file.
Machine: Apple M3 Pro, macOS, Node v24.16.0, isolated-vm 7.0.2, main @ `b3731e9c0`, load ~4–5.
Raw output: `mount.out.txt`, `layer.out.txt`, `layer-layered.out.txt`, `host.out.txt`, `seq.out.txt`,
`gen.out.txt`, `gen-mutants.out.txt`, `sweep.out.txt`, `gens.out.txt`. `layer.mjs` drives isolated-vm and rifty's codec from source, not the public API: worker-side costs of each arm, not a consumer's `exec`.

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
| full | 69.9 | 392 | 647 | 359 | invalid¹ | 48.3 | 219 / 51 |
| views | 66.3 | 190 | 454 | 157 | invalid¹ | 44.3 | 123 / 51 |
| lazy | 77.5 | 79.8 | 406 | 33.9 | 63.6 | 39.5 | 23 / 47 |
| worker | 75.3 | 76.7 | 393 | 51.0 | **259** | 51.8 | 23 / 19 |

¹ `full`/`views` keep rifty's async `Vfs` beside the sync mirror: their read stream comes back
empty and the run skips the append half of `stream` (end state 8 389 402 B, no `app.bin`, vs
16 778 091 B for the sync-only arms); `ok` was judged by the exit code alone, so these cells measured
other work (greptile review of `layer.mjs:436`).

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
Medians of 21 (ms); writes accumulate during a row (21 files); «fresh» / «after listing» = the same
21 own writes on two fresh sandboxes, the second after `list` of `/node_modules` and of every
package; idle = heap + ArrayBuffers per sandbox over 20 held sandboxes, one 10 KiB own file each.

| arm | create T1 / T95 | `writeFile` 10 KiB + cap check T1 / T95 | write a template file T1 / T95 | 21 writes fresh / after listing, T95 | idle T1 / T95 |
|---|---|---|---|---|---|
| views (a `MemoryFsSync` of views per sandbox, cap check walks it) | 4.66 / 283 | 0.55 / 30.6 | 0.68 / 30.1 | 30.2 / 30.1 | 112 KiB / 9.4 MiB |
| overlay (hand-written: difference + deleted set; rejected, ADR-0572 §2) | 0.11 / 0.02 | 0.16 / 0.15 | 0.29 / 0.30 | 0.16 / 0.14 | noise (−3 KiB / −480 KiB) |
| layered (`layered.ts`; cap check = the count over the state on the wire) | 0.27 / 0.06 | 0.03 / 0.02 | 0.05 / 0.06 | 0.02 / 0.02 | 5 KiB / 4 KiB |

`readFile`, `list('/node_modules')`, `remove` ≤ 0.06 ms in every arm. Requirements §3: «Хостовая
запись стоит O(размер записи + дифф), а не O(всего состояния)», «Память простаивающей песочницы у
потребителя не включает шаблон: N песочниц на одном шаблоне держат одну его копию» — `layered`
meets both for writes in `/workspace` (and a write costs the same after the host listed the whole
template: the cap check enters only changed directories; listing changes nothing); `views` does
not. A write **inside a template directory** grows with that directory's width — probe W.

## S — named sequences against live Node (`layered.ts`, `seq.mjs`, `seq.out.txt`)

`layered.ts` (probe prototype of ADR-0572 §2, the third construction): rifty's `MemoryFsSync`,
template entries entering it lazily by node — a directory with an origin and a lazy mark, a file
holding the template's bytes reference with an origin — every call then on the `MemoryFsSync`
unchanged. The state on the wire, by node identity: a node untouched from its origin is one row
(`lazy` / `ref`), anything else is explicit (an explicit directory is opaque). `layered-v1.ts`
derived a difference from path existence (review N2); `layered-v2.ts` put every held node on the
wire, so reading the template grew the state (fresh check, 2026-11-25). `seq.mjs` runs each
sequence against live `node` v24.16.0 over a real temp directory holding the same template (times
set) and program: in a fresh isolate (rifty `fs` → the layered class, state captured there,
rebuilt by the consumer), as host ops in the consumer, host ops → a run → the host, two runs in a
row. Compared: each call's error code, the final tree (kind, size, sha1, file mtime as «template
era» or «now»), the changed-paths list vs a walk of Node's before/after, the consumer's wire round
trip. Directory times are compared by probe G.

Result: **30/30**, exit 0 (1 on any FAIL): remove → write the same path; remove a directory → write
a child, with and without `mkdir`; `rmdir` + `mkdir`; `rename` of a template directory then
`require` from it; a template file moved out, a file moved in; a rename onto a non-empty
directory; `utimes`; a same-bytes overwrite; `EISDIR`; `EEXIST`; a non-recursive `rm` of a
non-empty directory; a copy out; host and host → run → host rows; two runs in a row; reading
template files puts no template bytes in the state; review N2's rows — a template directory renamed
then recreated, a template file turned into a directory with a child, a template directory turned
into a file, B → A after A → C, a rename onto an existing template file, a recursive copy merging
into a template directory; and review 4's S-b row, a copy overwriting a file in a nested template
directory.

## G — generated sequences (`gen.mjs`, `gen.out.txt`, `gen-mutants.out.txt`)

A seeded generator (`mulberry32`; `gen.mjs [N] [GUEST] [SEED_BASE] [--mutant=NAME]`, here seeds
1..3 000) builds 4–13-call sequences of `mkdir` (recursive or not), write, a host write (parents
created), `rm` (recursive, forced or not), `rename`, `cpSync` (recursive), `copyFileSync`,
`utimes`, read, `readdir` and `stat` over a 6-file template plus new paths, some named like
template entries so copies and renames merge into template directories; seven named regressions
(review N2's rows, S-a's `stat`, S-b's nested copy) run first. Each runs on rifty's flat
`MemoryFsSync` holding the same files (no layer) and on each construction. Checked: every call's
whole returned value (`stat`: kind, size, `nlink`, the four times stamped; `readdir`: names and
kinds), the tree (kinds, bytes, directories' and files' mtimes «template era» or «now»), the tree
after the state is carried over the wire and rebuilt on a fresh view, the same with a rebuild at a
seeded run boundary, the cap's count against an independent count of the wire, a times-independent
audit of the change marks (`LayeredFs.audit()`: no node that differs from its origin under an
unmarked origin directory), and that the sequence's reads alone leave the wire a fresh sandbox's.
The sequences whose flat rifty FS agrees with `node:fs` over a real directory (calls and tree) are
then compared with Node too; the others differ from Node without any layer (rifty FS semantics,
counted apart). A failure prints its seed and a greedily minimized sequence.

| construction | named regressions failing | ≠ rifty without a layer | reading grows the state | compared with Node / layer ≠ Node |
|---|---|---|---|---|
| `layered-v1.ts` (existence-derived difference) | 6 / 7 | **233 / 3 000** | — | 968 / 0 |
| `layered-v2.ts` (every held node on the wire, `stat` not materializing) | 1 / 7 | 47 / 3 000 | **3 000 / 3 000** | 1 046 / 0 |
| `layered.ts` (node identity, untouched = one row) | **0 / 7** | **0 / 3 000** | **0 / 3 000** | 1 046 / 0 |

1 954 of `layered.ts`'s 3 000 sequences are outside the Node comparison: rifty's FS without a
layer already differs from `node:fs` there (codes, times, `nlink` on APFS). Guest sample (seeds
1 000 001..1 000 300, rifty `fs` in a fresh isolate over `layered.ts` vs rifty's plain
`MemoryFsSync` with the same files in a fresh isolate vs `node` running the same program): layer =
no layer 300 / 300, equal to Node 126 / 300, the rest differ from Node without a template too
(recorded: `backlog/runtime-js/fs-generated-sequence-divergences-from-node`). The shared template
bytes hash the same after all runs. Exit 0 only if `layered.ts` is clean on every count.

Mutants (`gen.mjs 1000 0 0 --mutant=NAME`, `gen-mutants.out.txt`), each a one-line defect of the
rule — all exit 1: `stat-lazy` (no materialize before `stat`) 18 / 1 000, minimized to one
`stat('/node_modules')`; `cp-dest-only` (a copy marks only its destination root) the S-b named row
+ 1 / 1 000, minimized to a host write of `/node_modules/b/lib/x.js` + `cp b → a`; `rm-no-dirty`
141 / 1 000; `write-no-dirty` 214 / 1 000, minimized to one write; `changed-ignored` 728 / 1 000;
`rename-no-dirty` 61 / 1 000, minimized to one rename.

## W — the cost sweep (`sweep.mjs`, `sweep.out.txt`)

Consumer side, `layered.ts`, synthetic `/node_modules/pkg-NNNNN/…` templates, one axis at a time
from a base of 100 packages × 5 files × 4 KiB at package depth 2: bytes (4 → 64 KiB per file),
width (10 / 100 / 1 000 / 5 000 packages), files per package (5 → 50), depth (2 → 6 → 12);
operations: host `writeFile` 10 B, `readFile`, `list`, `remove`, and what the next `exec` carries
(rows, wire bytes = blob + rows' JSON, the cap's count); places: `/workspace/x.js`,
`/node_modules/new.js`, `/node_modules/pkg-00000/new.js`, `/node_modules/pkg-00000/lib/new.js`.
Median of 21, fresh sandbox per cell. Ratio last / first value along each axis (≈ 1 = flat):

| axis | `/workspace` (every op, wire, cap) | template dir, depth 0–2: read, list | template dir, depth 0–2: write, remove, rows, wire, cap |
|---|---|---|---|
| bytes ×16 | flat | flat | flat |
| files ×10 | flat | flat | flat (depth 2: ×1.4–1.8, the package's own `lib` listing 5 → 50 rows) |
| depth ×6 | flat | flat | flat |
| **width ×500** | **flat** | flat (µs) | **×230–500: linear in the width** |

Width at a template place, write in `/node_modules/pkg-00000/new.js`:

| packages | write + cap check | rows | wire | cap units |
|---|---|---|---|---|
| 10 | 0.03 ms | 10 | 2.1 KB | 10 602 |
| 100 | 0.22 ms | 100 | 16.7 KB | 76 122 |
| 1 000 | 2.19 ms | 1 000 | 163 KB | 731 322 |
| 5 000 | 11.7 ms | 5 000 | 815 KB | 3 643 322 |

`/workspace/x.js` at every width: 0.004 ms, 1 row, 388 B, 2 282 units. ~730 cap units per row
(path-length dependent). The per-run cost inside the isolate (template copy + index) grows with the
template's bytes and entries — the user-accepted F1 dependency, measured in L and F, not here.

## F — the F1 return condition's metric on real programs (`gens.mjs`, `gens.out.txt`)

The four libraries' canonical generators (`../isolate-library-probe/gen/{pdf,docx,pptx,xlsx}.cjs`)
over the four-library `node_modules` (npm ci of `../isolate-library-probe/deps`: 8 000 files,
86.6 MB) in a fresh isolate: `layered` (template copy + index + run + capture) vs `state` (the same
files in the sandbox's state, its run phase only), medians of 7, ms, load ~5 on 12 cores:

| empty | pdf | docx | pptx | xlsx | 4 at once pdf / xlsx (wall) |
|---|---|---|---|---|---|
| +20 | +21 | +18 | +25 | +19 | 286 vs 245 / 559 vs 552 |

Smallest passing `memoryLimit`, empty file: 103 MiB over the template vs 190 with the files in the
state (an empty sandbox without a template: 19 MiB). Earlier runs at load 9–18 (before the per-call
cut and the third construction) scattered from −65 to +240 ms; the carrier re-measures on an idle
machine.

`layer-layered.out.txt` (T95, `views` vs `layered`, load ~5): semver 167 vs 86 ms (restore 88 vs
39, capture 35 vs 0.5), pdf-lib 319 vs 244, 1 000 writes 157 vs 80, floor 107 vs 99–103 MiB; four
pdf-lib runs at once 410 vs 338 ms wall; T1 semver 47 vs 46. The `stream` workload: `full`/`views`
keep rifty's async `Vfs` beside the sync mirror and their read stream comes back empty (the gap PR
#437 closes; their end states lack `app.bin`); the sync-only arms (`lazy`, `worker`, `layered`)
write both files as Node.

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
