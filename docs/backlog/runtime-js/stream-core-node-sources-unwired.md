---
area: runtime-js
status: ready
title: Node v24.16.0's stream core is vendored, generated and bound in rifty, unwired, with a CI differential against Node's bindings
created: 2026-11-25
why: First of the three core units of goal node-streams-as-in-node (8a): the generated core must exist and be proven before anything imports it, as the zlib engine (#452) does
epic: node-streams-as-in-node
sources: [docs/adr/runtime-js/0575-stream-core-and-fs-streams-are-node-v24-16-0-s-own-sources.md, docs/backlog/epics/node-streams-as-in-node/reference/results/ownership.txt]
code: [tools/publishing/generate-node-streams.mjs, packages/io/src/streams/node/bindings.ts, tests/integration/node-streams-differential.test.ts]
---

## Context

Unit 8a (map item 8a, ADR-0575 §1–2, §7). Vendored sources, generator (ADR-0574 pipeline + drift
check), bindings, zlib constants without the zlib module (`adapters.js:94`), the third-party
manifest entry before anything is published. `internal/events/abort_listener` is Node's file whole
(variant A); which variant ships is AL's (`runtime-js/stream-core-abort-listeners-host-event-target`).
Not wired: nothing imports it (as the zlib engine, PR #452). User scenario: the goal's (8a changes no
program's outcome: the carrier, `packages/isolate-host/tests/streams-scenario.test.ts`, stays as is).

Baseline on main `be99bee9e` (after #455, #456, #457, #459, #462, #467, #469), in-process, Node
v24.16.0, the program on rifty's `process` (the one the core binds): the generated core on Node's own
bindings equals live Node on every row of every item run (136); on rifty's bindings it equals that
on all but the rows pinned below. The probe's `results/` numbers
predate #455–#469 and are not this unit's base.

Differential, by `results/ownership.txt` row (owners there are the last unit of a row; here the
owner is the binding unit, since the differential bypasses the wiring 8c/9r/9w):

| ownership rows | here |
|---|---|
| in-process `m1`, hook matrix, `m2`, `m3`, `m6`, `m7`, `m8`, `m10` (8c, 9r, 9w, guard) | equal |
| in-process `m4`, `m5`, `w1`, `c-*` (10 programs) | equal but: `m4` «timers … for await», «timers … fs.read(fd) loop», `m5` «timers … WriteStream», pinned, owner 4; `m5` «member types» (`_writev`), owner 5; `w1` `win-4.out` masked (a race inside Node) |
| `b1` rows of 1, 2, 3 (landed) and its guards | equal (the fs.read-vs-timer guard by its declared Node outcomes, `RACES`) |
| `b1` «fs.writev / fs.fsync …» (5) | pinned, owner 5 |
| in-process `m9` (AL, 8c, guard) | «promises.pipeline … stopping listener», «finished(r, {signal}) …», «addAbortSignal …» pinned, owner AL; `map`, `reduce` equal |
| parity `cases/stream` (70) and `cases/fs` stream cases (7) | 74 run, equal; 3 not run (stdin/node-cli-eval kinds) |
| isolate rows (19) | not run: Node's bindings exist only in a Node process; the isolate gets the core at 8c (and 7) |
| Workbench `chromium-fd`/`chromium-d` rows (39; all of 4b's) | not run: browser-host fd cost, the core wired there at 8c/9r/9w |
| `zlib-diff` | not here: zlib unit 3's entry criterion, after 8c |

Added here (not in the table; programs in `tests/integration/node-streams-differential/programs/`,
review of PR #471 round 1):
- `p1-intrinsics-replaced` (31 rows, a process each) — a guest replaces an intrinsic after load. The
  core and the bindings read none (`builtinFactory`, no `startsWith`); 14 rows differ, all in rifty
  modules the core binds to: io `EventEmitter` (`slice`, `Map` get/set/delete), the vfs/fs path layer
  (`String` slice/includes/startsWith/endsWith/split, `Number.isInteger`), `fs.open`'s `Promise`
  (owner `runtime-js/post-guest-paths-use-replaceable-intrinsics`); `bind` (rifty `once` completes
  where Node's `_onceWrap` throws) and the uncaught report of `shift`/`splice` (owner
  `runtime-js/browser-host-realm-uncaught-fatal-report`).
- `p2-emitter-store`, `e1`–`e4` — the core's dependency on Node's `EventEmitter` (store, `eventNames`,
  unhandled `'error'`, `errorMonitor`, `captureRejections`, listener limit, statics), and `m10`'s
  listener counts: 17 rows, owner `runtime-js/events-static-surface` (its table).
- `p3-function-names` — names, lengths, `util.inspect` of the core's functions: equal but 2
  (rifty's inspect omits a function's own properties, `runtime-js/inspect-default-format-gaps`).
- `p4-binding-paths` — ordinary paths through each binding (Blob, Buffer/Uint8Array fs paths, web
  adapters with ArrayBuffer/SharedArrayBuffer/offset chunks, DEP0135 and `noDeprecation`, the safe-integer
  bound, hidden validator frames, aggregated destroy errors): equal but the warning hint
  (`rifty --trace-deprecation`, `runtime-js/process-versions-node-honesty`).
- `f1-file-url` — `ERR_INVALID_FILE_URL_HOST` `on a POSIX platform` vs Node `on darwin`/`linux`
  (`runtime-js/file-url-host-error-platform`).

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge). Taken into work
2026-11-26: S7 closed by Acceptance 4 below (rows of landed owners equal; the rest pinned with owner).

## Acceptance

1. Vendored: the 28 Node v24.16.0 files of ADR-0575 §1 + `LICENSE` under
   `tools/publishing/node-streams/vendor/`, each sha256-pinned in the generator, equal to
   `node-v24.16.0.tar.xz` (sha256 `2ff84a6d…f30f`). A changed vendored byte reds the generator
   (`tools/checks/node-streams-generator.test.ts`). → ADR-0575
2. Generated unedited: whole modules are the vendored text byte for byte; a selected module is
   upstream top-level statements unedited, in upstream order, between three generated parts (narrowed
   `primordials` header, `PRELUDE` of narrowed requires, `module.exports`); each in Node's builtin
   wrapper; committed as built, no minifier. The committed output equals a fresh run
   (`pnpm check:node-streams-drift`, CI lint-and-typecheck and `pr:check`); a changed generated byte,
   a new upstream `require`/`internalBinding` id or a new global read is red. After generation every
   function reachable from each module's exports (statics, prototype members, accessors) has Node's
   `name` and `length` (`names-vs-node.cjs`, against Node's own modules; RED on the minified output:
   24 paths). → ADR-0575
3. Bindings repeat Node's: the 79 primordials are Node's own value (43, same object) or Node's
   construction with Node's name and length; `internalBinding('constants').zlib` is Node's table (key
   order included) as data, no zlib module; `stream_wrap` indices and `UV_EOF` are Node's; the tables
   bind exactly the ids the generated core reads (`packages/io/tests/node-stream-bindings.test.ts`, a
   Node child with `--expose-internals`). Behaviour: every primordial that is not Node's object and
   every member of every `internalBinding`/internal module the bindings supply returns what Node's
   does on the same inputs (`bindings-vs-node.mts`), declared: `internalBinding('types')`'s brand
   tests (below). Intrinsics and host globals are captured at load, `util.inspect`/`format` when the
   core is created; the bindings call no live intrinsic (`p1`). Every binding mutant is killed by a
   row or declared unreachable (the table in the PR). → ADR-0575, I1
4. Differential (`tests/integration/node-streams-differential.test.ts`, CI `test:run`): every
   fixture program of the goal (`packages/isolate-host/tests/fixtures/streams-scenario/`), the hook
   matrix, the programs above and the parity cases, three ways — live Node, the core on Node's
   bindings, the core on rifty's — compared whole: exit (live Node's must be the item's declared
   code, `EXIT`, else 0), every stdout line, stderr without frames, the loader's source excerpt and
   the pid, and every file under the cwd at exit (the run's own included: an overwrite or delete
   shows). The rifty column has one `process`, rifty's, for the program and the core, its lifecycle
   (uncaught dispatch, fatal report, `beforeExit`, exit code) run by rifty's lifecycle code over
   Node's event loop; Node's stay the event loop, timers and microtasks. Declared, each from Node's
   own variance: `MASKED_OUTPUT` `w1` `win-4.out` must be 0 B or the first 1024 B (review: about
   half the runs each); `RACES` `b1` «fs.read callback vs a timer due now» (review under load:
   2.5–19 % `immediate` first) and hook matrix «Writable async _destroy callback» (6 of 1200),
   where every column gives one of Node's outcomes.
   The core on Node's bindings equals
   live Node on every row; on rifty's it equals that on every row but `PINNED`, each pinned on
   today's rifty value with its owner: 4 (`runtime-js/fs-callbacks-io-turn`), 5
   (`runtime-js/fs-writev-fsync`), AL, `runtime-js/post-guest-paths-use-replaceable-intrinsics`,
   `runtime-js/events-static-surface`, `runtime-js/browser-host-realm-uncaught-fatal-report`,
   `runtime-js/process-versions-node-honesty`, `runtime-js/inspect-default-format-gaps`,
   `runtime-js/file-url-host-error-platform`. Rows of landed owners 1, 2, 3 are equal, not pinned (4b's
   rows are all Workbench, not run). A pinned row that turns equal is red until
   its pin goes; every program and case is run or in `NOT_RUN` with its reason. → I1–I7, I9, I10
5. Not wired: `check:arch` `node-stream-core-has-no-production-importer` (a product importer is
   red). 0 B on every artifact, measured on HEAD against its merge-base with main (worktrees at
   equal-length paths): every file of `packages/*/dist`, `tools/shadow-registry/dist`,
   `services/eddy/dist` after `pnpm build:libs` (sha256; `guest.js` included) and of
   `apps/playground/dist` after `pnpm build:playground` byte-equal; `pnpm test:client-bundles`
   min/gzip of `main`/`sw`/generic/toolchain equal; `check:es-floor` green. Recorded in the PR
   body; re-measured by the reviewer at merge time. → ADR-0575 §7
6. License: `tools/publishing/third-party-manifest.json` records `io/src/streams/node/generated` as
   Node `v24.16.0` (MIT, `node.LICENSE`), marked `unshipped: runtime-js/stream-core-node-sources`
   (PR #452's mechanism, carried here): unused it is green, a package shipping it is red until 8c
   drops the mark; `pnpm check:third-party-notices` green. → ADR-0575 §1

Merge: 8a and 8b merge only once 8c's PR is open and its CI differential is green (ADR-0575 §7);
the PR stays open, titled `[hold: merges with stream-core 8c]`. A pin whose owner lands first (4,
PR #468) turns red here: the PR merging second drops it.

## Parity cases

The oracle is live Node v24.16.0 and Node's own bindings, per row (Acceptance 4). RED targets,
pinned with owner: `b1` writev types and `m5` member types (5); `m4`/`m5` timer rows (4); `m9` three
stopping-listener rows (AL); `p1` 14 rows (post-guest intrinsics, events, fatal report); `p2`, `e1`–`e4`,
`m10` 17 rows (`runtime-js/events-static-surface`); `p3` 2 (inspect); `p4` 1 (identity); `f1` 1.

## Out of scope

- Wiring (`node:stream`, io's exports, `fs` stream classes), internal consumers, the ES floor
  (`AbortSignal.any`, `Symbol.dispose`, `Promise.withResolvers`: creating the core without the last
  throws `node-streams: no primordial PromiseWithResolvers`), the isolate and browser hosts: 8c,
  9r, 9w, 7.
- Named gaps the core reaches only through a native handle: `stream_wrap` `WriteWrap`/`ShutdownWrap`,
  `uv.errname`/`getErrorMap`, `process.emitWarningSync` → `NotImplementedError`; `FileHandle` as an
  `fd` option (nothing is one; Node accepts it) until rifty has `FileHandle`.
- `internal/event_target` symbols on a host `EventTarget` (AL); rifty modules reading live intrinsics
  (`runtime-js/post-guest-paths-use-replaceable-intrinsics`).

## Decisions

- 2026-11-26 — author: output in `packages/io/src/streams/node/` (the probe's wiring place; 8c consumes it), committed as built: no minifier (review round 1: esbuild `minifySyntax` dropped 9 of Node's function names, its renamer made `HideStackFramesError2`); 271 022 B raw / 62 042 gzip; bundles minify downstream (8c's, with ADR §1's identifier rule).
- 2026-11-26 — author: the shared generator steps move to `tools/publishing/node-sources.mjs` (third consumer of the ADR-0574 pipeline); url-legacy and node-blob output byte-identical. PR #459's generator would join it.
- 2026-11-26 — author: primordials built as Node's `per_context/primordials.js` builds each (`uncurryThis = bind.bind(call)`, `makeSafe`, `SafePromise*` assigned, not named), per ADR-0575 §2 (not Node's file whole: ~1 500 entries for 79).
- 2026-11-26 — author: rifty modules through their registered factory (`builtinFactory`, io's registry, no live intrinsic) when the core reads them, each cached once; one not registered throws by name (no fallback); `process` read per call through the factory (ADR-0458); host globals captured with the primordials at bindings load, `util.inspect`/`format` when the core is created (Node's errors read `internal/util/inspect`, not the public `util`). Load order per host is 8c's.
- 2026-11-26 — author: zlib constants are a data module in io (generated from live Node's binding, equal by test); runtime-js keeps its copy until 8c or zlib unit 3 dedups (no product bytes change here).
- 2026-11-26 — author: `internalBinding('types')` → rifty's `util/types` (C++ `IsPromise`/`IsNativeError` have no exact JS brand check; read only by `promisify`'s DEP0174 test).
- 2026-11-26 — author: acorn is runtime-js's own dependency (8.16.0, pinned by the generator), the AST walk the generator's own: a root `acorn` devDependency (ADR-0575 §1's wording) hoisted `node_modules/acorn` and changed the playground bundle's CJS interop (`function-bind`'s lazy init; measured, reverted).
- 2026-11-26 — author: differential columns live Node / Node bindings / rifty bindings in children (rifty in-process, memory VFS); `fs` = the column's `fs` with the core's stream classes, as `lib/fs.js`; the rifty column's program sees rifty's `process` and `console` (bytes to fd 1/2 by `setDefaultProcessOutputSink`), Node's uncaught errors/rejections/`beforeExit`/exit handed to rifty's lifecycle (`process-lifecycle-events.ts`), browser-host fatal report (not the isolate's Node report); `p1` rows that end Node's process outside the core (`pop`, `apply`) are not rows.
- 2026-11-26 — author: `internal/v8/startup_snapshot.namespace.isBuildingSnapshot()` returns `0`, as Node's flag-buffer read (was `false`; the behaviour test).
- 2026-11-26 — author: the `unshipped` manifest mark is PR #452's code, carried verbatim; whichever merges second drops the duplicate.
