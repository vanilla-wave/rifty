# isolate-host FS snapshot — FIT probes (2026-11-22)

Machine: Apple M3 Pro, darwin-arm64, Node v24.16.0, isolated-vm 7.0.2, main
`50c9d8bf1`. Scripts: `isolate-host-fs-snapshot-probe/` (run from that dir;
build `spike.js` first:
`../../../../../packages/isolate-guest/node_modules/.bin/esbuild spike.ts --bundle --format=iife --platform=browser --target=es2022 --outfile=spike.js --inject:../../../../../packages/isolate-guest/src/guest/web-shim.ts`).
Throwaway prototypes, not the product codec.

## P1 — format candidates in a real isolate

`spike.ts` = three prototype codecs over a real rifty `MemoryFs`
(`createMemoryFs`) with the guest's own Web shim, in a real ivm isolate
(`driver.mjs <pack> 2048`). Export = walk FS → blob; import = blob → fresh
`MemoryFs`, then a content+mtime digest compares the trees. Median of 3.

Datasets (`dataset.mjs`, real files from the repo's `node_modules/.pnpm`, files ≤ 100 kB):
- small: 52 files, 6 dirs, 409 856 B;
- template scale: 20 958 files, 2 930 dirs, 94 871 742 B (requirements: 23 654 files, 94 861 284 B).

Template scale:

| Format | Bytes | gzip (host) | Export ms | Import ms | Tree equal |
|---|---|---|---|---|---|
| binary, CRC-32 | 95 083 698 | 17 976 285 | 624 | 525 | yes |
| binary, SHA-256 (rifty pure-JS `createHash`) | 95 083 698 | 17 975 251 | 4 443 | 3 826 | yes |
| binary, no checksum | 95 083 698 | 17 974 647 | 184 | 165 | yes |
| tar ustar, pax only for long names, SHA-256 trailer | 112 157 728 | 18 691 363 | 4 518 | 4 334 | no (s mtime) |
| tar + pax `mtime`/`atime` per entry, SHA-256 trailer | 134 578 208 | 19 340 142 | 6 343 | 5 601 | yes |
| JSON + base64 (`WorkspaceArchiveV1` shape) | 126 763 350 | 29 961 972 | 4 939 | 3 676 | no (no times) |

Heap (used + external) after JSON export: 831 MiB (binary: 204 MiB).
Small dataset: binary+CRC export 3 ms / import 4 ms; JSON 18 / 13 ms; tar 12–14 / 21–23 ms.

Reading: the checksum, not the layout, dominates the binary format; pure-JS
SHA-256 costs ~4.3 s of 4.4 s. tar needs a pax record per entry to keep
millisecond times (+41 % bytes). JSON+base64 holds a ~4× heap.

## P2 — memory floor (smallest ivm `memoryLimit` that succeeds)

`peak.mjs <pack> [view]`, binary+CRC, template scale (blob 90.7 MiB), FS fed
in 500-file batches:

| Phase | Floor MiB |
|---|---|
| FS alone | 111 |
| FS + export | 205 |
| import, file bytes copied (`slice`) | 197 |
| import, file bytes as views into the blob (`subarray`) | 103 |

Export holds the tree and the blob at once: ≈ 2 × S. Import with copies too;
views halve it but pin the whole blob for the life of every file.

## P3 — bytes across the ivm boundary

`probe-copy.mjs`: a 10-byte view over a 64 MiB buffer, host → isolate
(`arguments: {copy: true}`) and isolate → host (`reference.copy()`, a
`Callback` argument): the receiver gets `byteLength 10`, `buffer.byteLength
67108864` in every direction — ivm copies the whole backing store.
`probe-write.mjs`: guest `process.stdout.write(big.subarray(i, i+1))` over a
256 MiB buffer reaches the host hook as `[1, 1]` — the existing output path
already copies the range. 95 MB exact blob: copy out 10–39 ms, copy in 10–17 ms (P1 `copyOutMs`/`copyInMs`).

## P4 — what the guest FS holds (`guest-run.mjs` + `probe-fs.js`, real Node: `node -e` with `ROOT=/tmp/...`)

| Probe | rifty guest | real Node (APFS) |
|---|---|---|
| fresh FS tree | `/workspace/` only | — |
| `writeFileSync('lone\uD800')` | name kept, last unit `d800` | `fffd` (Node encodes UTF-8) |
| `utimesSync(f, 1000.123456, 2000.987654)` | atime 1000123, mtime 2000987 (integer ms) | 1000123.456 / 2000987.654 |
| `readFileSync` changes atime | no | yes |
| dir mtime after creating a child | unchanged | changed |
| `symlinkSync` / `chmodSync` / `linkSync` | `TypeError: fs.… is not a function` | ok |
| modes | 100666 / 40777 fixed | 100644 / 40755 |
| `readdirSync` order | code-unit sort (`B,Z,_,a,…,é,😀`) | — |

rifty's FS has no symlinks, hard links or modes (ADR-0050) and keeps any JS
string as a name: a snapshot has nothing to lose there, but its names must be
any JS string.

`oracle-cp.cjs` (real Node `fs.cpSync(…, {preserveTimestamps: true})`): mode,
size, nlink, mtimeMs, atimeMs survive a copy; ino and ctimeMs never do
(`utimes` sets ctime to now — POSIX); dir times are not preserved by `cpSync`.
