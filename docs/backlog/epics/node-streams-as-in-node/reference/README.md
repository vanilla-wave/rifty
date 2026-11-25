# Node streams probe (2026-11-25)

What a Node program gets from rifty's streams today, per unit of the goal
(`docs/backlog/epics/node-streams-as-in-node/`). Oracle: live Node v24.16.0, macOS arm64.
rifty: `725576a88`, which is main `b6d37fc01`'s stream code merged with later main (this branch is docs-only).

## Run

```sh
pnpm --filter @riftydev/isolate-host run build    # the sandbox runs the built guest
node --import tsx run.mjs "$(git rev-parse --show-toplevel)"   # writes results/*.txt
```

Each program runs four times, plus the two route-B runs (§Route B), six columns in all:

- `node`: real Node, in a temp dir.
- `rifty-inproc`: rifty's browser-host modules in a Node child (`inproc.mts`). The memory VFS is
  installed with its async surface, as the hosts install it. A bare `Buffer` is rifty's, as every host installs
  it. `process`, timers and console stay Node's (trap `parity-runner-in-process`), so no program
  prints `process` state.
- `rifty-inproc-sync`: the same, sync mirror only. This is the parity runner's wiring and PR #437's
  guest wiring.
- `rifty-isolate`: isolate host `createSandbox().exec`, the main guest bundle.

`c-*` programs get exceljs 4.4.0's installed closure, which includes graceful-fs 4.2.11, fstream 1.0.12,
unzipper 0.10.14, fast-csv 4.3.6 and jszip 3.10.2. A row is `same` only when its line and the exit
status both equal Node's. A line only a rifty run printed, such as an uncaught error, counts as
`extra`. Paths are masked (`<dir>`, `<repo>`).

The in-process runs use Node's timers and microtasks, not a browser realm's. Chromium runs are in
§Chromium below. The goal's carrier unit (map item 0) owns the Chromium line.

Limits: `route-b/parity.mjs` compares stdout only; exit status and stderr are not compared.

| Program | Unit (map, route B) | Measures |
|---|---|---|
| `c-xlsx-roundtrip.cjs` | carrier | exceljs `xlsx.readFile` → edit → `xlsx.writeFile` → reload |
| `c-csv-read.cjs` | carrier | exceljs `csv.readFile` (`createReadStream().pipe(fast-csv)`) |
| `c-graceful-fs.cjs` | carrier | graceful-fs `createWriteStream`/`createReadStream` |
| `c-unzip-stored.cjs` | carrier | unzipper `Extract` (fstream → graceful-fs → `fs.WriteStream`) on a STORE zip, without zlib |
| `c-for-await.cjs` | carrier | `for await` over `fs.createReadStream` |
| `c-late-listener.cjs` | carrier | `'data'` attached after `await null`, `setImmediate`, a 20 ms timer |
| `c-readable-read.cjs` | carrier | `on('readable')` + `read()` loop |
| `c-transform-big.cjs` | carrier | 16 MiB → async `Transform` → `fs.WriteStream`; in-flight = bytes emitted − bytes handed on |
| `c-pipeline-asyncgen.cjs` | carrier | `stream/promises.pipeline(fs.ReadStream, async function*, fs.WriteStream)` |
| `m1-lifecycle.cjs`, `m1-hooks-matrix` | 8 | hook called once (`ERR_MULTIPLE_CALLBACK`), destroy moment, `errored`/`closed`, `'close'` after `'end'`, the zlib `zlibBuffer`/`zlibOnError` shapes. The second runs `runtime-js/reference/stream-destroy-construct-hooks/matrix.cjs`. |
| `m2-core-members.cjs` | 8 (fs rows 9) | `readableFlowing`, `isPaused()`, `writableNeedDrain`, `Symbol.asyncDispose`, on plain and fs streams |
| `m3-legacy-stream.cjs` | 8 (fs rows 9) | `Readable/Writable → Stream → EventEmitter`, `instanceof Stream` |
| `m4-readstream.cjs` | 9 | `fs.ReadStream`: chain, members, class shapes (graceful-fs), paused buffer, modes, close, fd source, timers during a 16 MiB read |
| `m5-writestream.cjs` | 9 | `fs.WriteStream`: chain, members, class shapes (graceful-fs), drain, cork, close, order |
| `m6-transform-duplex.cjs` | 8 | `Transform` backpressure, `Duplex` members, per-side options, event order |
| `b1-bindings.cjs` | 1–5 | `string_decoder`/`Buffer` encoding names, `events.addAbortListener`, `fs.writev`/`fsync`, fs callback order |
| `m7-pipeline-stages.cjs` | 8 | `pipeline` function and async-generator stages, `pipeline`/`finished` callback arguments, premature close |
| `m8-constructor-options.cjs` | 8 | constructor option validation (`highWaterMark`, `signal`, `encoding`, `defaultEncoding`, hook options) per class; `write(chunk, '', cb)` |

Results: `results/summary.txt` (rows equal to Node per column) and one `results/<program>.txt` per
program (every row, every column, exit status, the first error line of stderr).

The cases that join with node:zlib (unzipper `Extract` on DEFLATE, the `createGzip` pipe) are proposed
for the zlib goal's carrier (`docs/backlog/epics/node-zlib-on-every-host/`, branch
`t3/zlib-engine-probe`). They are not repeated here.

## Route B (ADR-0575)

Two more columns:

- `rifty-inproc-B`: Node v24.16.0's stream core and `lib/internal/fs/streams.js`, unedited
  (`route-b/verbatim.cjs`), over rifty's `events`/`buffer`/`string_decoder`/`fs`. The other
  `internal/*` modules are Node's own (`--expose-internals`).
- `rifty-inproc-Bp`: the same sources, but every binding is rifty's (`route-b/product/`:
  `generate.mjs`, `bindings.ts`).

`route-b/run-all.sh` runs everything:

- `run.mjs`;
- `parity.mjs` (existing parity cases on A/B/Bp);
- `zlib-diff-b.mjs` (the zlib goal's differential with its rifty column on route B);
- `size.sh`;
- `bench.cjs`.

`route-b/product/run.sh` holds the product-shape parts and the throwaway product build
(`wiring.patch`; numbers in `results/route-b-product-build.txt`). `b1-bindings.cjs` measures the
modules the core binds to.

## Chromium (`chromium/`, `results/chromium/`)

The programs ran in real Chromium 148 on main `c2d03ce05`, on two hosts:

- **Workbench**: a COI browser-unit spec over the sealed Workbench fixture (`zz-nsg-workbench.spec.ts`).
- **SDK**: a no-COI toolchain sandbox spec (`zz-nsg-sdk.spec.ts`).

Each was compared against a Node oracle laid out the same way (`oracle.mjs`, `compare.mjs`).
`zz-nsg-durability*.spec.ts` checks the S7 durability fact.

To rerun, copy the specs into `tests/browser-unit/` and `tests/no-coi/`, run Playwright on dedicated
ports, and delete them afterwards. They ran the program set as it was when copied (`m4` 20 rows).

## How each results directory is made

| results | made by |
|---|---|
| `summary.txt`, `<program>.txt` | `run.mjs REPO NODE_SRC` with `ROUTE_B_GEN` set (`route-b/run-all.sh`). Columns `-Bp8c`/`-Bp9w`/`-Bp9r` are the unit windows. |
| `route-b-*.txt` | `route-b/run-all.sh` (parity, zlib-diff, size, bench) |
| `route-b-s5-consumers.txt` | `VERBOSE=1 route-b/parity.mjs REPO NODE_SRC <abs path to route-b/s5>` |
| `route-b-minify.txt` | `route-b/parity.mjs` with `ROUTE_B_GEN` from `product/generate.mjs --minify` vs `--minify-all` |
| `route-b-abort-semantics.txt` | `node route-b/abort-semantics.mjs` |
| `route-b-9r/` | `run.mjs` with `ONLY=c-`, `RESULTS=` that dir (column `rifty-inproc-Bp9r`) |
| `route-b-product-*.txt` | `route-b/product/run.sh` + a throwaway product build (its header) |
| `fd-hosts.txt` | `node --import tsx fd/fd-hosts.mjs REPO` |
| `ownership.txt` | `node ownership.mjs` over the directories above |
| `chromium/` | route A Chromium baseline: `chromium/zz-nsg-workbench.spec.ts`, `zz-nsg-sdk.spec.ts`, `zz-nsg-durability*.spec.ts` |
| `chromium-b/` | the same specs on a route-B product build (main `692babe13`); the 5 closure programs on Workbench are in `chromium-c/` |
| `chromium-c/` | `chromium/closure-tmp/zz-nsg-closure-tmp.spec.ts`: closure in the guest's `/tmp` (PR #453 helpers), routes A and B, main `5763d8fa1`; `b-c-transform-big-route-b-workbench.log.txt` holds the 73.5 s row |
| `chromium-d/` | `chromium/zz-nsg-streamprobe.spec.ts` with `streamprobe.cjs`/`streamplan.mjs`/`streamoracle.mjs`: 4/16 MiB stream read/write and a write in a 1000-file project, routes A/B, main `5763d8fa1`; `summary.txt` by `chromium/streamsummary.mjs` |
| `chromium-fd/` | `chromium/zz-nsg-fdread.spec.ts`, `zz-nsg-fdwrite.spec.ts` with `fdread.cjs`/`fdwrite.cjs`; SDK fd read: `chromium/zz-nsg-fdread-sdk.spec.ts` → `sdk.jsonl` (lane output `sdk-lane.txt`) |
| `abort-variants/` | `run.mjs` with `ONLY=m9` and `ONLY=m10`, `RESULTS=` that dir, `ROUTE_B_GEN` = variant A, `ROUTE_B_GEN_DERIVED` = `ABORT=derived product/generate.mjs` (variant B) |

Each Chromium spec is copied into `tests/browser-unit/` or `tests/no-coi/` of a throwaway worktree, run
on dedicated ports, and deleted.


## For executors (units 0, 1, 2, 3, 4, 4b)

Harness traps met while measuring:

- Workbench closure (exceljs, 5941 files): lay it out in the guest's `/tmp` with
  `packages/isolate-host/tests/closure-files.ts` and `tests/browser-unit/fixtures/zlib-scenario.ts`
  (`serveSteps`, `UNPACK`, `RUNNER`; PR #453), 11–12 s per program
  (`chromium/closure-tmp/zz-nsg-closure-tmp.spec.ts`).
  - A plain `cd /tmp/x && node x.cjs` is refused («package tree readiness is not published»): run
    the program by a child `node` from a project-root runner.
  - Seeding the closure into the project root takes about 35 min (unit P's cost); seeding through the
    boot plan's `files` never completed.
- SDK: `createSandbox({ requireCrossOriginIsolation: false, toolchain })`, then
  `project({ root }).run('node <file>')`. A COI page has no `node <file>` entry.
- Chromium specs are throwaway: copy into `tests/browser-unit/` (Workbench, COI) or `tests/no-coi/`
  (SDK) of a throwaway worktree, run Playwright on dedicated ports (check them free with `lsof -i`),
  delete the copies afterwards. `results/chromium*/` hold what each run printed.
- Route B product probe: `route-b/product/run.sh`. The throwaway product build applies
  `route-b/product/wiring.patch`; delete `packages/runtime-js/src/builtins/fs-streams.ts` first.
  `pnpm build:libs` then fails at `third-party-notices` until the Node sources have a
  `tools/publishing/third-party-manifest.json` entry (`results/chromium-c/route-b/build-libs.log.txt`).
- `run.mjs` with `ONLY=<prefix>` reruns some programs and merges them into the existing `summary.txt`.
  `ROUTE_B_GEN_DERIVED` adds the abort variant B column (`ABORT=derived product/generate.mjs`).
