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
| views (a `MemoryFsSync` of views per sandbox, cap check walks it) | 7.64 / 290 | 0.53 / 30.8 | 0.57 / 31.6 | 31.1 / 30.7 | 112 KiB / 9.3 MiB |
| overlay (hand-written: difference + deleted set; rejected, ADR-0572 §2) | 0.10 / 0.02 | 0.16 / 0.15 | 0.30 / 0.29 | 0.21 / 0.15 | noise (−3 KiB / −479 KiB) |
| layered (`layered.ts`; cap check = the count over the state on the wire) | 0.25 / 0.05 | 0.02 / 0.02 | 0.04 / 0.04 | 0.01 / 0.01 | 5 KiB / 4 KiB |

`readFile`, `list('/node_modules')`, `remove` ≤ 0.06 ms in every arm. Requirements §3: «Хостовая
запись стоит O(размер записи + дифф), а не O(всего состояния)», «Память простаивающей песочницы у
потребителя не включает шаблон: N песочниц на одном шаблоне держат одну его копию» — `layered`
meets both for writes in `/workspace` that follow no template change (H's rows); `views` does not.
Beyond that, a host op's cost and idle memory are bounded by the template entries touched and
marked, never by bytes — probe W.

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
template entries so copies and renames merge into template directories, and (review 5, S1) a
source tree copied into a template directory, half the time with an entry whose kind clashes with
the destination's, so the copy fails midway after writing its first entries; eight named
regressions (review N2's rows, S-a's `stat`, S-b's nested copy, review 5's failing recursive copy
into a template directory) run first. Each runs on rifty's flat
`MemoryFsSync` holding the same files (no layer) and on each construction. Checked: every call's
whole returned value (`stat`: kind, size, `nlink`, the four times stamped; `readdir`: names and
kinds), the tree (kinds, bytes, directories' and files' mtimes «template era» or «now»), the tree
after the state is carried over the wire and rebuilt on a fresh view, the same with a rebuild at a
seeded run boundary, the cap's count against an independent count of the wire, a times-independent
audit of the change marks (`LayeredFs.audit()`: no node that differs from its origin under an
unmarked origin directory), and that the sequence's reads alone leave the wire a fresh sandbox's.
The sequences whose flat rifty FS agrees with `node:fs` over a real directory (calls and tree) are
then compared with Node too; the others differ from Node without any layer (rifty FS semantics,
counted apart). Node runs each sequence in its own process (`gen-oracle.mjs`): `fs.cpSync` of a
source directory onto a destination file aborts Node v24.16.0 (`libc++abi … filesystem_error …
create_directory: File exists`, exit 134 — a Node bug, outside rifty), so those sequences are
counted «Node aborted» and not compared. `stat` is compared with Node without `atime` / `ctime`
(Node cannot set a past `ctime`) and, on macOS, without `nlink` (APFS counts every entry); with
rifty's own FS, whole. A failure prints its seed and a greedily minimized sequence.

| construction | named regressions failing | ≠ rifty without a layer | reading grows the state | compared with Node / layer ≠ Node / Node aborted |
|---|---|---|---|---|
| `layered-v1.ts` (existence-derived difference) | 7 / 8 | **721 / 3 000** | — | 997 / 0 / 85 |
| `layered-v2.ts` (every held node on the wire, `stat` not materializing) | 1 / 8 | 50 / 3 000 | **3 000 / 3 000** | 1 265 / 0 / 166 |
| `layered.ts` (node identity, untouched = one row) | **0 / 8** | **0 / 3 000** | **0 / 3 000** | 1 288 / 0 / 167 |

Node coverage of `layered.ts`: 1 288 / 3 000 (43 %) compared with Node; 167 Node aborted; 1 545
outside the comparison — rifty's FS without a layer already differs from `node:fs` there (codes,
times: rifty bumps a directory's mtime on an overwrite in it). Guest sample (seeds
1 000 001..1 000 300, rifty `fs` in a fresh isolate over `layered.ts` vs rifty's plain
`MemoryFsSync` with the same files in a fresh isolate vs `node` running the same program): layer =
no layer 300 / 300 (whole `stat` values compared), equal to Node 145 / 300, Node aborted 18, the rest differ from Node without a template too
(recorded: `backlog/runtime-js/fs-generated-sequence-divergences-from-node`). The shared template
bytes hash the same after all runs. Exit 0 only if `layered.ts` is clean on every count.

Mutants (`gen.mjs 1000 0 0 --mutant=NAME`, `gen-mutants.out.txt`), each a one-line defect of the
rule — all exit 1: `stat-lazy` (no materialize before `stat`) 17 / 1 000, minimized to one
`stat('/node_modules')`; `cp-dest-only` (a copy marks only its destination root) the S-b named row
+ 21 / 1 000, minimized to a host write of `/workspace/cc/sub/n.js` + `cp cc → /node_modules/b`;
`cp-mark-after` (review 5, S1: a copy marks after the backend call) review 5's named row + 36 /
1 000, minimized to a copy of a tree holding a directory over the template file
`/node_modules/a/lib/x.js`; `rm-no-dirty` 94 / 1 000, minimized to one `rm`; `write-no-dirty`
130 / 1 000, minimized to one write; `changed-ignored` 1 000 / 1 000; `rename-no-dirty` 38 / 1 000.
A layer call throwing where rifty's FS returns counts as a class failure (`v1` throws on
review 5's conflicting copies).

## W — the cost sweep (`sweep.mjs`, `sweep.out.txt`)

Consumer side, `layered.ts`, synthetic `/node_modules/pkg-NNNNN/…` templates, one axis at a time
from a base of 100 packages × 5 files × 4 KiB at package depth 2: bytes (4 → 64 KiB per file),
width (10 / 100 / 1 000 / 5 000 packages), files per package (5 → 50), depth (2 → 6 → 12).
Scenarios, each timed on a fresh sandbox (median of 21), then what the next `exec` carries (rows,
wire bytes = blob + rows' JSON) and the cap's count: host writes at `/workspace` and in template
directories of depth 0/1/2; a removal; the FIRST read of a template file, `list` and `stat` of
`/node_modules`; a rename of a template package; a copy of one file into a package; a `/workspace`
write after one template write; an idle sandbox's memory (heap + ArrayBuffers per sandbox over 20),
fresh, after one `list('/node_modules')` and after the whole walk. Not varied: the number of sandboxes (each holds its
own), the in-isolate cost per run (template copy + index: grows with bytes and entries — the
user-accepted F1 dependency, probes L and F).

Scenarios added after review 4's fresh check: removing a template file on a fresh sandbox;
removing and renaming a `/workspace` file after the host listed `/node_modules` and every package.
Added after review 5 (Б-П) — the sum axis: the host walking 10 packages, then the whole template
(the ceiling: `readdir` + `stat` of every entry), `/workspace` ops and a template write after the
whole walk, a no-op `mkdir -p /workspace` fresh and after the walk, idle memory after the walk and
after a run boundary (the sandbox rebuilt from its wire) following the walk or one template write.
Idle memory: heap + ArrayBuffers holding 20 sandboxes minus after dropping them, per sandbox,
median of 3.

**The bound.** A host op's cost and an idle sandbox's memory are bounded by the entries of the
template directories touched since the sandbox's last run plus those of every template directory
marked since its creation — touching a directory (its first read, `list` or `stat`, or a write,
removal, rename or copy in it) touches all its entries; any mutating call into one marks it, a
failed one included, and a mark persists through runs; the ceiling is the whole index — never the
bytes. A marked directory carries a row per entry on the wire and in the cap; each row costs the
cap 384 + 8 × path length + 80 × depth units (ADR-0567 §7; ~730 at these paths). Idle memory per
touched entry 0.49–0.70 KiB, growing with path length (after the whole walk: 0.52 on the
four-library template, 0.54 at 5 000 packages, 0.70 at depth 12). A run boundary drops what only
reading touched from the wire and the cap (1 row, 1 608 units, as fresh); idle memory falls with it
but not to a fresh sandbox's (below; the residue's cause not isolated).

Ratio last / first value along each axis (≈ 1 = flat; sub-0.05 ms times are noisy):

| axis | every scenario: time, rows, wire, cap, idle |
|---|---|
| bytes ×16 | flat (sub-0.01 ms times ×0.3–0.75), the whole walk and idle after it included |
| files ×10 | flat except where more entries are touched: a write at depth 2 (×1.94 time, ×1.43 rows: its own `lib` lists 5 → 50 children), a first read of a file in `lib` (×1.63), a removal of a template file (×1.93), the walks (×5.1 / ×6.7), idle after the whole walk (×6.7) and after it + a run boundary (×6.1) — entries ×7.4; `/workspace` ops after the whole walk ×1.6–2.4 (≤ 0.008 ms) |
| depth ×6 | flat except a first read / removal of a template file (×1.57 / ×1.63): O(path length); the walks (×4.6 / ×6.5), idle after the whole walk (×3.1) and after it + a run boundary (×2.8) — entries ×2.4, longer paths; `/workspace` ops after the whole walk ×1.5–1.7 |
| **width ×500** | `/workspace` with no template touch: rows, wire and cap flat, time ×1.67 (0.003 → 0.005 ms); **a write, removal, rename or copy in a template directory ×156–406 time, ×357–500 rows**; a first read / `list` / `stat` ×249–529 time, rows ×1; walking 10 packages ×31 (its `list('/node_modules')`), the whole template ×605; idle after one listing ×326, after the whole walk ×441, after it + a run boundary ×193; after the whole walk, `/workspace` write / remove / rename ×6 / ×7.7 / ×4.8 and a no-op `mkdir -p /workspace` 0 → 0.005 ms |

That last item is not a walk (the whole walk of 35 001 entries is 126 ms) nor per-call work of the
layer: the no-op `mkdir` — one `#touch` of an already materialized path — slows alike. Cause not
isolated.

Width, `/node_modules` 10 → 100 → 1 000 → 5 000 packages (ms; rows on the wire after it):

| scenario | 10 | 100 | 1 000 | 5 000 |
|---|---|---|---|---|
| write `/workspace` | 0.003, 1 | 0.004, 1 | 0.004, 1 | 0.005, 1 |
| write in a package (depth 1) | 0.021, 10 | 0.136, 100 | 1.39, 1 000 | 7.135, 5 000 |
| removal of a file just written in a package | 0.008, 10 | 0.027, 100 | 0.238, 1 000 | 1.251, 5 000 |
| removal of a template file | 0.037, 13 | 0.152, 103 | 1.388, 1 003 | 7.168, 5 003 |
| first read of a template file | 0.023, 1 | 0.116, 1 | 1.097, 1 | 5.728, 1 |
| first `list` / `stat` of `/node_modules` | 0.011 / 0.011, 1 | 0.106 / 0.104, 1 | 1.137 / 1.064, 1 | 5.817 / 5.727, 1 |
| rename a package | 0.019, 10 | 0.134, 100 | 1.357, 1 000 | 7.117, 5 000 |
| copy 1 file into a package | 0.027, 10 | 0.142, 100 | 1.402, 1 000 | 7.214, 5 000 |
| write `/workspace` after one template write | 0.007, 10 | 0.028, 100 | 0.271, 1 000 | 1.247, 5 000 |
| remove / rename a `/workspace` file after one listing | 0.003 / 0.006, 1 | 0.004 / 0.006, 1 | 0.005 / 0.007, 1 | 0.017 / 0.019, 1 |
| walk 10 packages / the whole template (entries: 71 / 701 / 7 001 / 35 001) | 0.201 / 0.208, 1 | 0.302 / 2.187, 1 | 1.375 / 22.819, 1 | 6.206 / 125.889, 1 |
| after the whole walk: write / remove / rename in `/workspace`; no-op `mkdir -p` | 0.003 / 0.003 / 0.006; 0 | 0.003 / 0.004 / 0.006; 0.001 | 0.007 / 0.011 / 0.014; 0.002 | 0.018 / 0.023 / 0.029; 0.005 |
| after the whole walk: write in a package | 0.007, 10 | 0.028, 100 | 0.284, 1 000 | 1.419, 5 000 |
| idle, KiB: fresh / after one listing / after the whole walk | 3 / 10 / 43 | 3 / 74 / 384 | 3 / 663 / 3 805 | 3 / 3 255 / 18 951 |
| idle, KiB, after a run boundary: following the whole walk / one write in a package | 5 / 9 | 24 / 58 | 214 / 527 | 963 / 2 838 |

The ceiling: 0.54 KiB of idle memory per touched entry (18 951 KiB / 35 001), ~3.6 µs to touch one
(126 ms / 35 001); the cap after the whole walk is a fresh sandbox's (1 608 units: reads change
nothing); after a run boundary 963 KiB stay (0.028 KiB per entry walked) — the wire is a fresh
sandbox's, so this residue is not state; measured alone (the four-library template, 3 × 3 runs,
not committed) it is 3 KiB, inside the sweep 231 KiB: not isolated, not claimed reset.

The four-library template itself (`sweep.mjs <node_modules of npm ci ../isolate-library-probe/deps>`:
8 793 entries, 86.6 MB, `/node_modules` width 180; package `pdf-lib`):

| scenario | ms | rows on the wire | wire bytes | cap units |
|---|---|---|---|---|
| write `/workspace` | 0.004 | 1 | 388 | 2 282 |
| first read of a template file / first `list` / first `stat` of `/node_modules` | 0.215 / 0.204 / 0.195 | 1 | 303 | 1 608 |
| write in `pdf-lib` (depth 1) | 0.276 | 189 | 32 690 | 147 386 (0.2 % of the 64 MiB cap) |
| removal of a template file / rename of `pdf-lib` / copy of 1 file into it | 0.272 / 0.259 / 0.281 | 188 / 181 / 189 | 32 395 / 31 102 / 32 852 | 145 632 / 138 888 / 148 844 |
| write `/workspace` after one write in `pdf-lib` | 0.054 | 189 | 32 775 | 148 060 |
| walk 10 packages / **the whole template (ceiling)** | 3.111 / **32.058** | 1 | 303 | 1 608 |
| after the whole walk: write / remove / rename in `/workspace`; no-op `mkdir -p` | 0.009 / 0.014 / 0.017; 0.003 | 1 | 388 / 303 / 390 | 2 282 / 1 608 / 2 290 |
| after the whole walk: write in `pdf-lib` | 0.075 | 189 | 32 690 | 147 386 |
| idle sandbox, KiB: fresh / after one `list('/node_modules')` / **after the whole walk** | — | — | — | 3 / 132 / **4 549** |
| idle sandbox, KiB, after a run boundary: following the whole walk / one write in `pdf-lib` | — | — | — | 231 / 108 |

The ceiling on the consumer's template: 4.4 MiB per idle sandbox that walked everything (0.52 KiB
per entry), 32 ms for the walk; every write in a package carries ~189 rows (~0.2 % of the cap) for
the sandbox's life. Not timed here: `toWire`, the rebuild from the wire and the changed-paths diff
— each linear in the rows, i.e. the same bound. The cause: a template directory is materialized
whole on first touch, and a marked one is explicit and opaque (ADR-0572 Consequences, the user fork
in the goal map).

## F — the F1 return condition's metric on real programs (`gens.mjs`, `gens.out.txt`)

The four libraries' canonical generators (`../isolate-library-probe/gen/{pdf,docx,pptx,xlsx}.cjs`)
over the four-library `node_modules` (npm ci of `../isolate-library-probe/deps`: 8 000 files,
86.6 MB) in a fresh isolate: `layered` (template copy + index + run + capture) vs `state` (the same
files in the sandbox's state, its run phase only), medians of 7, ms, 12 cores; re-run twice after
review 5's `layered.ts` changes (marks before the upper call, the untouched check without `stat`,
lazy rows' times from the origin — the capture's `toWire` path changed), both in `gens.out.txt`:

| run | empty | pdf | docx | pptx | xlsx | 4 at once pdf / xlsx (wall) |
|---|---|---|---|---|---|---|
| before review 5, load ~5 | +20 | +21 | +18 | +25 | +19 | 286 vs 245 / 559 vs 552 |
| 1, load ~2.5 | +15 | +17 | +16 | +28 | +41 | 270 vs 241 / 555 vs 484 (**+71**) |
| 2, load 2.2 → 3.7 | +14 | +20 | +16 | +30 | +30 | 260 vs 234 / 504 vs 467 |

Run 1's four-at-once xlsx, +71 ms, is 1 ms over the F1 return condition's 50 + 20 ms — at load
~2.5, not the condition's idle machine (load < 2), on the probe, not landed code; run 2 +37. The
condition is decided in map items 5 / 7; this edge goes to the user with the manager's report.

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
