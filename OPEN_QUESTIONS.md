# Open Questions

Living buffer for provisional design decisions made by AI agents during work, awaiting human review. See D-007 in `PROJECT_PLAN.md`.

## How to use

When you encounter a **reversible** design choice during implementation:

1. Make a provisional decision
2. Add an entry below using the template
3. Mark the code with `// TODO(ADR): Q-YYYY-MM-DD-NNN`
4. Continue working — do not stop

When a question is reviewed:
- **Confirmed:** promote to ADR via `pnpm adr:promote Q-...`. This removes `TODO(ADR)` markers and creates an ADR entry.
- **Rejected:** rework with a new approach; entry is moved to "Rejected" section below for historical record.
- **Deferred:** update `Needs human review by` and leave in place.

## Status

- 🟢 Active: provisional decision in code, awaiting review
- 🟡 Under review: human is currently evaluating
- ⚪ Promoted: moved to ADR (kept here briefly for traceability, then archived)
- 🔴 Rejected: see "Rejected" section

---

## Active

## Q-2026-06-07-324: optional-subtree partial-failure — rifty SALVAGES surviving required siblings (vs npm atomic-rollback)

**Status:** 🟢 Active
**Encountered in:** #24 concurrency-fetch risk-closing tests (`packages/npm-client/src/installer-concurrency.test.ts`), characterizing the deferred-fetch walk's optional-failure behavior
**Milestone:** M10
**Author (agent session):** 2026-06-07

### Context

`installer.ts` `walkAndPin` (#24, deferred bounded-concurrency fetch) handles a failed optional dep non-fatally. The optional BOUNDARY node awaits its own fetch before recursing (skip-whole-subtree on a boundary-fetch failure — npm parity, covered by the existing "skips the ENTIRE optional subtree" test). But a boundary that fetches OK, then has a REQUIRED grandchild whose fetch fails, behaves differently: required grandchildren are DEFERRED fetches that inherit the boundary's `optional` descriptor, settled via `Promise.allSettled`. A failed grandchild is warned-and-skipped (attributed to the optional boundary) while its surviving required SIBLINGS still pin.

### Provisional decision (current behavior, pinned)

rifty SALVAGES the survivors: for root → main → opt(optional, OK) → [gcOK(req, OK), gcFail(req, FAIL)], the install keeps main + opt + gcOK and skips only gcFail (warned as "optional dependency opt@… of main could not be installed"). The whole install stays non-fatal.

### Divergence from npm (the judgment call)

Real npm treats an optional dependency's subtree ATOMICALLY: if any required descendant of an optional dep fails, the WHOLE optional subtree rolls back (opt, gcOK, gcFail all absent). rifty's deferred-fetch walk instead salvages the surviving required siblings — a genuine Node-parity divergence, not a bug in the concurrency refactor (the old serial walk had the same shape once the boundary fetch itself succeeded).

### Why this is a separate IRREVERSIBLE decision, not settled here

Flipping to npm atomic-rollback is an observable Node-parity change (reversibility checklist rule 4) — it needs its own future ADR weighing: tracking which pins belong to which optional subtree, unwinding partial pins + on-disk writes, and the warn-message contract. This OQ does NOT make that flip; it records the divergence and PINS the provisional current (salvage) behavior via a CHARACTERIZATION test so the flip cannot happen silently.

### Code markers

- Cross-ref comment at the optional-boundary recurse / `fetchTasks` settle site in `packages/npm-client/src/installer.ts` (`walkAndPin`) pointing here.
- Characterization test: `packages/npm-client/src/installer-concurrency.test.ts` ("CHARACTERIZATION: salvages surviving required grandchildren …").

### Residual edge (#24 dedup-gate fix, 2026-06-07)

An optional-boundary fetch REJECTION now rolls back the `scheduled`/`flatByName` claims it made so a later REQUIRED visit of the same name re-attempts and aborts (npm parity; see CHANGELOG #24 follow-on). This is orthogonal to the salvage behavior above (the salvage path is the boundary's REQUIRED grandchildren via `fetchTasks`, untouched by the boundary-rejection rollback). The shared `inFlight` promise is intentionally NOT rolled back: optional-then-required attempts of one `(name,version)` still collapse to a single (rejected) network call, so the dedup guarantee holds while the required attempt correctly re-throws. The interaction NOT covered by a test: an optional-boundary failure that also wins a flat slot a *prior* required visit had already claimed — impossible today (first-wins claims at the prior required visit, so `claimedFlat` is false and the rollback no-ops), but worth re-checking if placement ever stops being first-wins.

### Reversibility justification

- Public APIs affected: none — `install()` signature + non-fatal-optional contract unchanged; only the partial-failure salvage shape is at issue.
- Rough cost to revert/flip: the atomic-rollback variant is NOT a revert — it is new subtree-tracking + unwind logic, hence its own ADR.
- External dependencies involved: none.

### Needs human review by

End of milestone M10.

## Q-2026-06-06-319: OPFS `writeFileSync` single shared cache/write-through slice (+ WASI `fd_write` aliasing gate)

**Status:** 🟢 Active
**Encountered in:** JS-runtime perf audit item #3 (`docs/perf/js-runtime-perf-audit-2026-06-05.md` + `…-adr-plan-2026-06-06.md`)
<!-- Rich-terminal/coreutils research (docs/research/rich-terminal-coreutils-2026-06-06.md):
     IRREVERSIBLE forks → ADR-0088..0086. REVERSIBLE forks recorded below (Q-2026-06-06-401..406),
     pre-implementation (no code markers yet). -->

## Q-2026-06-06-401: single shared home for the grep/tree-walker logic

**Status:** 🟢 Active
**Encountered in:** rich-terminal research (ADR-0088 coreutils strategy; ADR-0092 git read-ops)
**Milestone:** M10/M12
**Author (agent session):** 2026-06-06

### Context

`grep` (promoted from `vfs-grep`) and the facade `grep`/`list` tools (and the ADR-0092 git read-ops) all want the same recursive readdir + match walk. The current `packages/runtime-js/src/utils/vfs-grep.ts` imports `readFileSync/readdirSync/Dirent` from the runtime-js `builtins/fs.ts` node:fs FACADE (method-form `Dirent.isDirectory()`), NOT `@riftydev/vfs` directly.

### Provisional decision

Lean **(b)**: relocate ONE pure walker into shell/vfs rewired onto `syncMirror()` (field-form `VfsDirent.isDirectory` boolean), shared by builtin + facade tool, to avoid two-path divergence. Alternative **(a)** (re-export `vfsGrep` from `runtime-js/src/index.ts`) is simpler but keeps the method-form Dirent shape and a cross-layer import. REVERSIBLE while the walker stays an internal util; becomes IRREVERSIBLE only if a re-export adds public API. NB the method→field Dirent adaptation is real work, not a move. The Q-2026-05-30-061 ripgrep-WASM deferral is unaffected.

### Code markers

IMPLEMENTED this phase: `packages/shell/src/commands/_walk.ts` — option (b) pure walker on field-form `VfsDirent`, no runtime-js import; consumed by `commands/grep.ts` (`-r`) and `commands/find.ts`. Facade-tool / ADR-0092 git read-ops reuse still pending.

## Q-2026-06-06-402: `ls`/`grep` `--color` via hand-rolled SGR (not picocolors)

**Status:** 🟢 Active
**Encountered in:** rich-terminal research (ADR-0088; ADR-0089 isTTY gating)
**Milestone:** M10
**Author (agent session):** 2026-06-06

### Context

`OpfsFsSync.writeFileSync` (ADR-0072) took TWO independent defensive `data.slice()` per write — one for the content cache, one for the async OPFS write-through — i.e. 2N copies/write. The aliasing hazard the slices guard: `readFileBytesSync` returns the cache BY REFERENCE (opfs-sync.ts), and WASI `fd_write` reuses `fdEntry.data` IN PLACE on a fitting write (fd.ts:86-88), then write-throughs that buffer via `syncMirror().writeFileSync`. So the write-side copy is the sole barrier severing a live mutable caller buffer from cached content.

### Provisional decision

Take ONE defensive slice and reuse it for BOTH the content-cache `set` and the write-through enqueue (2N→N copies/write). The write-through consumer (`OpfsVfs.writeFile`) only passes the buffer to `createWritable().write()` — read-only — so the two surfaces can safely share one copy. The single entry-point slice is RETAINED; merging the two is safe, dropping the copy is the actual regression. An OPFS blocking-gate review (item #3) returned **safe-to-proceed** on exactly this reasoning.

### Concrete judgment call (why OQ, not just CHANGELOG)

The merge makes the content cache and the in-flight async write-through ALIAS the same buffer. A sync caller that mutates the `readFileBytesSync`-returned buffer AFTER a write but BEFORE `flush()` drains would now also perturb the not-yet-drained write-through (the two-slice version isolated it). In practice callers don't mutate post-write and `OpfsVfs.writeFile` snapshots synchronously, so this is the one behavior delta — a provisional judgment pinned by the aliasing guard tests, hence OQ.

### Code markers

- `// TODO(ADR): Q-2026-06-06-319` at the shared-slice site in `packages/vfs/src/opfs-sync.ts` (`writeFileSync`).

### Reversibility justification

- Public APIs affected: none — internal to `OpfsFsSync.writeFileSync`; `FsSync` surface unchanged.
- Rough cost to revert: re-add the second `data.slice()` (1 line, 1 file).
- External dependencies involved: none.
- Guard tests (BLOCKING per the gate): `packages/vfs/src/opfs-sync.test.ts` (caller-mutation isolation + cache/write-through agreement) and a complementary `packages/runtime-wasi/src/syscalls/fd.test.ts` (fd_write in-place reuse stays cache-coherent).

### Needs human review by

End of milestone M10.

## Q-2026-06-06-320: loader `package.json` parse cache — key (abs path) + full-clear invalidation

**Status:** 🟢 Active
**Encountered in:** JS-runtime perf audit item #5 (`docs/perf/js-runtime-perf-audit-2026-06-05.md` line 59 + `…-adr-plan-2026-06-06.md` line 41/127)
**Milestone:** M10
Color output needs raw SGR (`\x1b[1;34m…\x1b[0m`) to xterm. picocolors is the popular pick but its **browser build returns plain (uncolored) strings — emits no SGR** (a render-colors PR was rejected as Chrome-only), so it's actively wrong here.

### Provisional decision

A ~20–40-line LS_COLORS/SGR helper in `packages/shell/src/`, zero-dep, strictly more correct than picocolors. Emission MUST be gated on `ctx.isTTY` (ADR-0089) — `--color=auto` suppresses SGR into redirects/pipes. Known limitation: hand-rolled palette won't match `$LS_COLORS`; ASCII-only column width (no wcwidth). REVERSIBLE (internal helper).

### Code markers

IMPLEMENTED this phase: `packages/shell/src/commands/_sgr.ts` (`sgr`/`colorize`, dirs-only subset, identity when disabled); `commands/ls.ts` gates `--color=auto` on `ctx.isTTY`. See also [[Q-2026-06-07-411]] (ls `--color` not byte-fixtured vs gls).

## Q-2026-06-06-403: stdout/stderr kept separate internally, merged only at the xterm sink

**Status:** 🟢 Active
**Encountered in:** rich-terminal research (ADR-0089; jsh reference §3)
**Milestone:** M10/M12
**Author (agent session):** 2026-06-06

### Context

N modules from one package re-decoded+re-parsed that package's `package.json` N times (the 4 resolver parse sites: `readPackageJson` called from `resolveAsDirectory`/`resolveInsidePackage`/`resolveImportsSpecifier`, plus the inline parse in `findPackageScope`). The audit's prior "immutable, no invalidation" rationale is WRONG: the `load-fixture` reload hot path overwrites files (incl. package.json) then calls `loader.invalidate()` (worker-entry.ts), so an unwired cache serves a stale `type`/`main`/`exports` and silently flips a sibling `.js`'s ESM/CJS classification.

### Provisional decision

A `Map<absPackageJsonPath, PackageJson>` owned by the `createResolver` closure, consulted/populated at all 4 parse sites (only SUCCESSFUL parses cached — a parse failure stays uncached so `readPackageJson`'s SYNTAX_ERROR throw and `findPackageScope`'s `{}` fallback each keep byte-identical behaviour). Exposed as `Resolver.clearCaches()`; `loader.invalidate()` calls it on BOTH the full-clear and targeted-id arms (package.json is package-scoped, not per-module-id, so a targeted invalidate cannot know which manifest changed → full-clear). Slightly more aggressive than `transformCache`'s per-id delete; acceptable — package.json edits are rare, correctness > micro-retention.

### Concrete judgment call (why OQ, not just CHANGELOG)

The full-clear-even-on-targeted-invalidate stance and the success-only caching are real semantic choices a reviewer may revisit (e.g. a per-package-scoped invalidate later). Also: `clearCaches()` adds a method to the (internal, runtime-js-only) `Resolver` interface — not re-exported cross-package, so REVERSIBLE, but recorded here for audit.

### Code markers

- `// TODO(ADR): Q-2026-06-06-320` on the `pkgCache` declaration in `packages/runtime-js/src/module-loader/resolver.ts`, and on the `resolver.clearCaches()` coupling in `loader.ts` `invalidate`.

### Reversibility justification

- Public APIs affected: none cross-package — `Resolver` is internal to runtime-js (consumed by `loader.ts`); `createModuleLoader`/`ModuleLoader` surface unchanged.
- Rough cost to revert: drop the cache + `clearCaches()` (resolver.ts + the loader coupling, ~1 file each).
- External dependencies involved: none.
- Guard tests: `packages/runtime-js/src/module-loader/resolver-cache.test.ts` (parse-once; edit→invalidate→fresh gate; full-clear) + parity `tools/node-parity-runner/cases/modules/pkg-type-module-js-classification.case.ts`.

### Needs human review by

End of milestone M10.

## Q-2026-06-06-321: resolver resolution cache — key, full-clear-on-invalidate, never cache not-found

**Status:** 🟢 Active
**Encountered in:** JS-runtime perf audit item #15 (`docs/perf/js-runtime-perf-audit-2026-06-05.md` line 71 + `…-adr-plan-2026-06-06.md` line 42/128)
**Milestone:** M10
jsh merges stdout+stderr into one `process.output` stream at the terminal. rifty already keeps fd1/fd2 separate in `CommandContext` (`stdout`/`stderr` writers). Builtins write usage/errors to fd2.

### Provisional decision

Keep fd1/fd2 **separate internally**; merge ONLY at the xterm sink (the playground terminal). Preserves Node parity, `$?`, and future `2>&1` faithfulness — the merge is a presentation concern, not the contract. REVERSIBLE/small.

### Code markers

(none — pre-implementation; already the shape of `CommandContext`.)

## Q-2026-06-06-404: awk / full-sed deferred (`NotImplementedError` + compat ❌)

**Status:** 🟢 Active
**Encountered in:** rich-terminal research (ADR-0088 §4; gap matrix §5)
**Milestone:** M12+
**Author (agent session):** 2026-06-06

### Context

`resolveSpecifierToFile` re-ran the full `node_modules` walk + package.json reads for every import edge — `react` from 200 files = 200 walks. The whole risk is invalidation: the shared VFS is mutated by guest `fs.writeFileSync` / npm install WITHOUT firing `loader.invalidate()`, so a cached miss (or a cached not-exported throw) would be permanently wrong.

### Provisional decision

A memo in the `createResolver` closure keyed exactly `${esm?1:0}\0${fromDir}\0${specifier}` → resolved file-id string, set ONLY on a successful (non-null) resolve. Non-negotiable rules:
1. **NEVER cache not-found** — a `null` from `resolveSpecifierToFile` leaves the memo untouched, so a later-created file (guest write / install) resolves on the next attempt.
2. **NEVER cache the `PACKAGE_PATH_NOT_EXPORTED` throw** — it propagates before the `set`, structurally un-cacheable.
3. **Full-clear on ANY invalidate** — the cache is input-keyed and cannot be pruned by resolved id, so both the full and targeted arms of `loader.invalidate()` clear it whole (via `Resolver.clearCaches()`, shared with #5). `readResolved` is OUTSIDE the memo — a hit still re-reads source fresh.

`fromDir` (not `fromFile`) is the correct key: any two files in one dir resolve a specifier identically, so keying on dir is both correct and a better hit rate.

### Concrete judgment call (why OQ, not just CHANGELOG)

The key shape, the full-clear-on-targeted-invalidate stance, and the never-cache-negative policy are provisional judgment calls a reviewer may revisit (e.g. a bounded negative cache once a VFS change-event exists). Shares `clearCaches()` with #5.

### Code markers

- `// TODO(ADR): Q-2026-06-06-321` on the `resolveCache` declaration in `packages/runtime-js/src/module-loader/resolver.ts`, and on the `resolver.clearCaches()` coupling in `loader.ts` `invalidate`.

### Reversibility justification

- Public APIs affected: none cross-package — internal to the resolver closure + the internal `Resolver` interface.
- Rough cost to revert: drop the memo + the `resolveCache` half of `clearCaches()`.
- External dependencies involved: none.
- Guard tests: `packages/runtime-js/src/module-loader/resolver-cache.test.ts` (resolve-once; full-clear; targeted-invalidate-also-full-clears; not-found-never-cached; not-exported-throw-never-cached). The `test:integration` suite (real-install / nested-install / vite-like / express-style / real-packages) is the critical guard that the cache did not break npm-installed module loading.

### Needs human review by

End of milestone M10.

## Q-2026-06-06-323: when to overturn the page-buffered cross-realm preview deferral (ADR-0048 D2) and ship the v3 frame bump

**Status:** 🟢 Active — DEFER (upholds ADR-0048 D2 / ADR-0017 M12 / ADR-0055 "do NOT ship v3")
**Encountered in:** JS-runtime perf audit item #22 fix(b); reconsidered by a decision subagent (ADR-0063) on 2026-06-06 and **upheld**
**Milestone:** M12
awk and full sed are an interpreter-class effort; the JS ecosystem ports are emscripten-WASM-only (a vendored binary = IRREVERSIBLE, ADR-0088 Option B territory).

### Provisional decision

**Defer.** `awk`/full-`sed` throw `NotImplementedError` + register `❌` (no silent stub), so the agent fails loudly. A pure-JS `sed s///` subset (~80–120 LOC) is an optional later add if a verified need appears (REVERSIBLE). Full awk/sed only via the deferred uutils-WASM path (Q-2026-05-30-061 sibling).

### Code markers

(none — pre-implementation; register ❌ when the builtin set lands.)

## Q-2026-06-06-405: background `&` / job model deferred

**Status:** 🟢 Active
**Encountered in:** rich-terminal research (§6 #7); distinct from the ADR-0089 cancellation contract
**Milestone:** M12+ kernel
**Author (agent session):** 2026-06-06

### Context

The perf audit proposed building true end-to-end page↔worker `ReadableStream` streaming for the cross-realm preview response path (remove the second O(M) page-side concat copy + head-of-line latency), which requires bumping `PREVIEW_PORT_FRAME_VERSION` 2→3. A decision subagent reconsidered the recorded deferral against ADR-0048, ADR-0017, ADR-0055 and the code.

### Provisional decision

**Uphold the deferral.** Keep the page side accumulating + concatenating on `reply-stream-end`; do not bump the frame to v3 yet. Load-bearing reasons (verified in code/ADRs):
1. The transport real streaming needs does not exist — both bridge ends still run on `BroadcastChannel` (preview-port.ts:163,307); the only `MessagePort` reference is the M12-aspiration comment at preview-port.ts:14. Streaming over BroadcastChannel yields **no backpressure** (the actual point), so v3-now is a throwaway intermediate before M12 re-bumps it.
2. ADR-0055 explicitly: "the v3 frame bump … contradicts ADR-0048 D2 / ADR-0017's M12 deferral … **Do NOT ship v3 under this ratification**"; its named gate (Worker-as-opencode-owner, ADR-0046) is unmet.
3. The benefit doesn't land on real workloads — the audit rates the removed copy "low" + production-unverifiable; the only large-stream consumer (opencode `/event`) already streams via the page-direct SW→page path.

`#22 fix(a)` (drop the redundant page-side re-copy at preview-port.ts:385-387, no frame change) is behavior-preserving and proceeds independently (CHANGELOG only).

### Concrete trigger to overturn (any one)

1. The M12 MessagePort transport (ADR-0017) lands — end-to-end `ReadableStream` + real backpressure ship in that one pass (one frame bump, not two).
2. A **Worker-owned** SSE/long-poll workload becomes real (Worker becomes opencode owner, ADR-0046 gate) — making the page-buffered path an indefinite hang, not merely a copy cost.
3. A measured profile shows the page-side concat copy / HOL latency is material on a shipped workload.

### Code markers (none — captured here; reversible)

## Q-2026-06-06-322: per-spawn env/argv sharing buys ~0 perf (postMessage clones regardless) — defer to the diff-wire variant (ADR/rule1) or the pre-warm pool (ADR-0088)

**Status:** 🟢 Active — DEFER (no code change; spawn-worker.ts untouched)
**Encountered in:** JS-runtime perf audit item #20 (`docs/perf/js-runtime-perf-audit-2026-06-05.md:95`)
**Milestone:** M10
`Shell.run` rejects bare `&` (`NotImplementedError('shell.background')`). The non-terminating-foreground-server problem (vite/node http) is solved by the ADR-0089 cancellation contract (Ctrl-C resolves `run`), NOT by `&`. True backgrounding needs a job model.

### Provisional decision

**Defer** `&`/job control as a separate decision; it ties to **Q-2026-06-05-317** (kernel native server-process support) and is explicitly NOT subsumed by ADR-0089. Its own ADR when taken up (IRREVERSIBLE — kernel public behaviour).

### Code markers

(none — pre-implementation; the bare-`&` throw already exists in `shell.ts`.)

## Q-2026-06-06-406: agent file ops — structured-tool-first, minimal bash fallback

**Status:** 🟢 Active
**Encountered in:** rich-terminal research (§1 reframe, §5, §9; ADR-0092 git)
**Milestone:** M12 (opencode facade)
**Author (agent session):** 2026-06-06

### Context

Audit #20 flagged the per-spawn env+argv structured-clone (`spawnKernelWorker` builds `fullSpec` then `worker.postMessage(init, [...])` in `packages/kernel/src/spawn-worker.ts`). The in-gate fix proposed (freeze + share one canonical env object) does **not** reduce that cost: `postMessage` structured-clones `env` (Record) and `argv` (array) into the child realm regardless of object identity or `Object.freeze` — non-transferables are always deep-copied. Verified there is also no redundant PARENT-side clone to dedupe: `fullSpec` takes `spec.env`/`spec.argv` by reference, and the one spread in the path (`process-manager.ts` `{...spec, cwd}`) is shallow and leaves those references untouched.

### Provisional decision

**No code change.** Do not freeze/share env (buys nothing) and do not ship a CHANGELOG perf claim for a no-op. Record the finding here:

1. **Measured no-op in-gate:** the freeze+share variant yields ~0 wire/CPU savings; the structured-clone is intrinsic to crossing the realm boundary.
2. **Wire payload must stay byte-identical:** any in-gate edit must keep `WorkerSpawnSpec` serializing the same own-enumerable env/argv — the child realm depends on receiving the full env + argv.
3. **The only edit that removes the clone flips to rule1 (ADR):** a per-spawn diff/overrides wire over a hoisted shared canonical env changes the `WorkerSpawnSpec` wire shape (cross-package public API in `packages/kernel/src/worker-entry.ts`) → IRREVERSIBLE per the reversibility checklist rule 1; it needs an ADR, not this OPEN_QUESTIONS line. If anyone implements it, reclassify.
4. **The real spawn-latency lever is deferred:** a worker pre-warm pool (1–2 fresh never-executed workers) is the audit's "biggest spawn-latency lever" (audit:95/138), gated on a measured spawn spike, tracked as the prospective ADR-0088. Env/argv micro-tuning is not on the critical path.

### Concrete trigger to overturn (any one)

1. A measured spawn-rate spike (test runners / `worker_threads` fan-out) makes the env/argv clone material on a shipped workload → revisit the diff-wire variant (then via an ADR, rule1).
2. The pre-warm pool work (ADR-0088) lands — fold any env/argv sharing into that pass once the wire shape is being revised anyway.

### Code markers (none — no code change; captured here)
opencode agents have two channels: structured file tools (read/grep/glob/list/edit/write) + one bash tool. Models still shell out to `rg`/`ls`/`find` (opencode #14791/#6506) even when structured tools exist.

### Provisional decision

**Structured-tool-first**: the dominant channel is pure-JS facade tools over the VFS (no pipe dependency); keep a `list` tool (opencode #6506) and tune the facade prompt to curb shell exploration. The literal-bash fallback is lower priority and gated on the M12 pipes+glob+stdin chain (ADR-0089/0084). REVERSIBLE facade-design lean.

### Code markers

(none — pre-implementation, M12 facade work.)

## Q-2026-06-07-407: shell command-file layout — `commands/<cmd>.ts` + `_shared.ts` barrel

**Status:** 🟢 Active · **Encountered in:** ADR-0088 coreutils builtins impl · **Milestone:** M10 · **Author:** 2026-06-07

Each new builtin is its own `packages/shell/src/commands/<cmd>.ts` (`export const <cmd>: ShellCommand`), sharing `commands/_shared.ts` (`resolve`/`enc`/`dec`); `builtins.ts` is the registration barrel. Chosen for clean parallel fan-out (one file per builtin, no merge conflicts) over a monolithic `builtins.ts`. File-structure-inside-a-package = always-reversible per CLAUDE.md (recorded because every builtin depends on the convention). Existing 9 builtins not yet relocated (left in `builtins.ts`) — a cosmetic follow-up, not required.

## Q-2026-06-07-408: head/tail GNU sign semantics (`-n -N` / `-n +N`)

**Status:** 🟢 Active · **Encountered in:** ADR-0088 head/tail impl · **Milestone:** M10 · **Author:** 2026-06-07

Implemented full GNU sign semantics: `head -n -N` = all but last N; `head -c -N` = all but last N bytes; `tail -n +N` = from line N (1-based); `tail -c +N` = from byte N. Cheap + a real correctness gotcha agents/humans hit. REVERSIBLE (no public-API impact). Pinned by head/tail unit tests. `tail -f` throws NotImplementedError (no polling loop).

## Q-2026-06-07-409: realpath = normalize+exists (no symlink layer)

**Status:** 🟢 Active · **Encountered in:** ADR-0088 realpath impl · **Milestone:** M10 · **Author:** 2026-06-07

VFS has no symlinks (ADR-0050), so `realpath` of an existing path = its normalized absolute path; a missing component → exit 1 (default `-e`/`-P`), `-m` allows missing. Mirrors runtime-js `realpathSync`. Documented as a GNU-divergence for the compat matrix (milestone closer). `-s`/`--relative-to`/`--relative-base` throw NotImplementedError. REVERSIBLE.

## Q-2026-06-07-410: tier-c builtin parity cases tracked for the DoD closer

**Status:** 🟢 Active · **Encountered in:** ADR-0093 vs landed file-arg builtins · **Milestone:** M10/M11 · **Author:** 2026-06-07

ADR-0093 (c) mandates a node-parity-runner case per tier-c builtin. The landed builtins ship rigorous vitest unit tests but no node-parity cases yet. Pure path-math builtins (basename/dirname/realpath) are string-only → a node:fs "parity case" would be engine-identical by construction (the "force-fit" anti-pattern ADR-0093 itself warns against); their honest parity rides on rifty's node:path parity (existing `cases/path`). The genuinely non-redundant cases are for the new ADR-0090 fs primitives (renameSync mtime / cpSync recursive) routed through runtime-js `node:fs` (unit U32, not yet done) + read/count/slice cases for wc/head/tail/cat. Tracked here + in CHANGELOG; to be added with U32 before the milestone-DoD closer. REVERSIBLE (test infra).

## Q-2026-06-05-318: deferred `RIFTY_RFV_*` → `RIFTY_RT_*` env rename + `Mode` token rename (post-ADR-0078)

**Status:** 🟢 Active
**Encountered in:** ADR-0078 (generic ProjectSpec/Template runtime)
**Milestone:** M10 polish
**Author (agent session):** 2026-06-05

### Context

ADR-0078 made the real-vite worker template-agnostic but, to keep the blast radius small, left two Vite-branded names:

1. The `RIFTY_RFV_*` env prefix (RFV = "real Vite") now names a generic surface (`RIFTY_RFV_PORT/ROOT/ENTRY/TEMPLATE`). It also keys the snapshot (ADR-0076), write (ADR-0043), HMR, and node_modules (ADR-0080) BroadcastChannels via `channelNameFor`.
2. The internal `Mode` token `'real-vite'` is read at ~24 sites incl. the ADR-0076 snapshot gate and the e2e `[data-preset]` contract.

### Provisional decision

Defer both renames. Re-keying the channels or the mode token now would touch four bridges and ~24 read sites for zero functional gain, and risks desyncing the `RIFTY_RFV_PORT`-keyed channels mid-change. Generic UI naming is already achieved via `ProjectSpec.displayName`.

### What a fuller cleanup needs (not done here)

A mechanical sweep renaming `RIFTY_RFV_*` → `RIFTY_RT_*` (and optionally `Mode` `'real-vite'` → `'project'`) once the switcher/channel contracts have settled — reversible, single-PR, no behavioural change. Coordinate with the m10 e2e (worker log markers) so the prefix and the asserted strings move together.

### Code markers (none — captured in ADR-0078 + this entry; reversible)

## Q-2026-06-05-317: kernel kills long-running (server) worker entries on top-level-await resolve

**Status:** 🟢 Active
**Encountered in:** ADR-0077 (real-vite preview fix), diagnosing the `502 preview-port bridge timeout`
**Milestone:** M11/M12 kernel
**Author (agent session):** 2026-06-05

### Context

`@riftydev/kernel`'s `installWorkerEntry` (`worker-entry.ts`) runs the entry module then unconditionally `postMessage({type:'exit'})` → `closePorts()` → `self.close()`. Correct for a run-to-completion program (REPL/CLI), but a **long-running dev server** (Vite-in-Worker, ADR-0043) resolves its top-level `await` *after* it starts listening, so the kernel tears the realm down a beat later — the server dies and every subsequent request hits a dead worker.

### Provisional decision

Worked around **playground-locally**: `real-vite-bootstrap` ends with `await new Promise<never>(() => {})` so the entry never resolves and the realm lives until `.kill()` (ADR-0077). This keeps the fix off the kernel's public surface.

### What a proper fix needs (not done here)

The kernel should natively support **server-shaped** processes — e.g. a spawn flag or an explicit `process`-driven exit/shutdown signal — so a server need not defeat the run-to-completion model with a never-resolving promise (which also means the worker can only exit via `worker.terminate()`, losing any graceful-shutdown hook). IRREVERSIBLE (kernel public behaviour) → its own ADR when taken up.

**Update (2026-06-05):** ADR-0080 (lazy `node_modules` remote-read) is now a **second consumer** of this keep-alive workaround — the worker must stay live to answer the page explorer's reads. Two consumers strengthen the case for native kernel server-process support; the workaround is no longer a one-off.

### Code markers (none — captured in ADR-0077 + this entry; 1-line playground workaround, reversible)

## Q-2026-06-04-316: project/template switcher — gallery promoted, header mode-toggles kept

**Status:** ⚪ Promoted → ADR-0079 (single switcher) + ADR-0078 (more templates)
**Encountered in:** playground "finishing-up" pass (console-scroll + switcher + real-vite FS), alongside ADR-0076
**Milestone:** M10 polish
**Author (agent session):** 2026-06-04

**Resolution (2026-06-05):** Both deferred items are now done. The "more
templates" headroom is delivered by **ADR-0078** (generic ProjectSpec/Template
runtime). The single unified switcher is delivered by **ADR-0079**: the header
`.rf-seg` is removed, the Templates gallery is the one switcher, and the m7/m10
e2e contracts were moved onto it as a deliberate contract change (incl.
correcting m10's stale worker-log markers). The deferred non-expandable
`node_modules` placeholder is superseded by **ADR-0080** (now lazily
*expandable*). This entry can be archived.

### Context

User feedback: "the project switcher looks strange. Let's design it so there can be more templates." Two surfaces currently switch projects/modes: the sidebar gallery (scales by category) and the header `.rf-seg` (`Real Vite` / `Dev Mode`) — a non-scaling pair that duplicates the gallery's "Live preview" presets. The visible "strangeness" was compounded by full-colour emoji tile icons clashing with the monochrome theme, and by the scalable gallery being hidden behind an activity-bar icon (boot default view is Explorer).

### Provisional decision

Make the **gallery the canonical, scalable Templates switcher** (retitled "Templates"; semantic-icon-keyed presets → trivial to add more; monochrome vendored SVG icons replace emoji — see the 2026-06-04 library review quick-win). **Keep the header `Real Vite` / `Dev Mode` seg** as quick mode-toggles: e2e locks them (`m7-preview-sw` clicks `[data-action="dev-mode"]` and asserts the text "Dev Mode"; `m10-hmr` clicks `[data-action="real-vite"]`), and CLAUDE.md forbids editing tests to enable a redesign.

### What a fuller redesign needs (not done here)

If we want a single unified switcher (drop/relocate the header seg), the `data-action`/text contracts must move with it and the e2e specs updated *as a deliberate contract change* (not to make code pass) — a focused follow-up. Also deferred: a non-expandable `node_modules` placeholder node in the real-vite mirror (presence is already flagged via `nodeModulesPresent`, ADR-0076).

### Code markers (none — captured in ADR-0076 + this entry; UI-only, reversible)

## Q-2026-06-03-308: in-frame preview navigation aborts under cross-origin isolation (SW routes sub-frame nav to the wrong owner)

**Status:** 🟢 Active
**Encountered in:** ADR-0073 (playground UX overhaul), verifying the dev/real-vite preview presets
**Milestone:** M7/M10 follow-up
**Author (agent session):** 2026-06-03

### Context

The in-page preview `iframe` navigation to `/preview/<port>/` aborts with `net::ERR_ABORTED` under the cross-origin-isolated playground page, even though a page `fetch()` of the same route returns 200 (the path `m7-preview-sw.spec.ts` covers). Root cause: `routePreview` (ADR-0031) resolves the preview owner from `event.resultingClientId`, which for an iframe *navigation* is the iframe's own about-to-exist client — not the main-thread bridge that owns the registered port — so the handshake never completes and the navigation commit aborts. **Pre-existing** (the iframe-render path was never CI-covered: m7 uses `fetch`, m10-hmr is skipped by default, and the suite runs against `pnpm dev`).

### Provisional decision

`PreviewPanel` reports preview readiness **honestly** — it polls the route, attempts the iframe nav, and only shows `live` if the navigation actually committed; otherwise `unavailable` with a hint and the "↗ new tab" escape hatch. The four REPL presets (the core click-&-play) are unaffected and render fully.

### What a fix needs (not done here)

Route sub-frame *navigations* to the controlling-window bridge owner instead of `resultingClientId`. That changes public SW routing behaviour and **reconsiders ADR-0031**, so per the workflow it requires a dedicated decision subagent producing a superseding ADR — a focused follow-up, out of scope for the playground overhaul. A CI smoke of the `vite preview` (production) build would also have caught the related prod-worker gap ADR-0073 fixed; worth adding.

## Q-2026-06-03-309: light theme deferred — playground ships dark-only

**Status:** 🟢 Active
**Encountered in:** ADR-0073 (design system)
**Milestone:** M10 polish
**Author (agent session):** 2026-06-03

### Context

The chosen direction is a polished dark IDE. A light/dark toggle would need coordinated theming of three surfaces (CSS tokens, the Monaco `rifty-dark` theme, and the hard-coded `RiftyTerminal` xterm theme — see Q-310). Provisional: ship dark-only; the design system is token-based, so a light theme is an additive `:root[data-theme="light"]` layer later.

### Code markers

(none — deferred non-goal recorded in ADR-0073's "Alternatives considered"; ship dark-only, no provisional code to mark.)

## Q-2026-06-03-310: terminal not themed/fonted to match (RiftyTerminal theme is hard-coded, not in its options)

**Status:** 🟢 Active
**Encountered in:** ADR-0073 (design system)
**Milestone:** M10 polish
**Author (agent session):** 2026-06-03

### Context

`RiftyTerminal` hard-codes its xterm `theme` (`#0f1115`/`#e6e6e6`) and `fontFamily` (system mono) in its constructor; `RiftyTerminalOptions` exposes only `onInput`/`onSignal`. Matching the terminal exactly (IBM Plex Mono + design tokens) would require adding a `theme`/`fontFamily` option to `RiftyTerminalOptions` — a **public API change between packages** (IRREVERSIBLE), needing its own ADR. Provisional: leave the terminal as-is and anchor the playground palette on its existing ink so the surfaces read as one.

### Code markers

(none — deferred; the fix is a public-API change to `RiftyTerminalOptions` that needs its own ADR and is not yet built. No provisional code to mark.)

## Q-2026-06-04-311: playground sidebar defaults to Explorer (not Presets) at boot

**Status:** 🟢 Active
**Encountered in:** ADR-0075 (VSCode shell), recomposing the left rail into an activity-bar + sidebar
**Milestone:** M10 polish
**Author (agent session):** 2026-06-04

### Context

The old left rail was the preset gallery. The VSCode shell puts both Explorer and Presets behind an activity bar; one must be the boot default. Chosen: **Explorer**, because the file manager is the headline new feature and VSCode opens to Explorer. Verified that no e2e asserts `[data-testid="gallery"]`/`[data-preset]` at boot, so this is selector-safe. Reversible: flip one default if the welcoming "click a preset" first-touch is preferred.

### Code markers

`// TODO(ADR): Q-2026-06-04-311` at the `useLayout` default `view` initializer.

## Q-2026-06-04-312: file-explorer refresh is a bounded poll (no VFS change events)

**Status:** 🟢 Active
**Encountered in:** ADR-0075 (VFS file explorer)
**Milestone:** M10 polish
**Author (agent session):** 2026-06-04

### Context

`@riftydev/vfs` exposes no change events, so the explorer refreshes via (1) an action-triggered nonce and (2) a 1.5 s poll of *expanded* dirs while the Explorer view is visible and the page is foregrounded. The correct long-term fix — emitting events from the VFS write path — touches a lower layer (IRREVERSIBLE) and is out of scope. Reversible: tune the interval or replace it with events later.

### Code markers

`// TODO(ADR): Q-2026-06-04-312` at the poll `setInterval` in `FileExplorer`.

## Q-2026-06-04-313: directory rename via copyTree+rm (no native `renameSync` on the sync mirror)

**Status:** ⚪ Promoted → ADR-0090 (VFS `copyFileSync`/`cpSync`/`renameSync` primitives)

**Resolution (2026-06-06):** Promoted by **ADR-0090** — native mtime-preserving, atomic-where-possible `renameSync` + `copyFileSync`/`cpSync` added to `FsSync`. The `glue/fs-ops.ts` copyTree+rm rename workaround migrates onto `renameSync` (file case) and the `// TODO(ADR): Q-2026-06-04-313` marker is removed when that lands. Entry kept briefly for traceability.

**Encountered in:** ADR-0075 (file explorer actions)
**Milestone:** M10 polish
**Author (agent session):** 2026-06-04

### Context

`FsSync` has no `renameSync`. Rename is implemented honestly: files via read-bytes → write-new-path → `rmSync(old)`; directories via a recursive `copyTree` + `rmSync(old,{recursive})`. This is a real implementation (not a silent stub), but it copies subtrees rather than moving in place. Reversible: add a native `renameSync` to the VFS (lower-layer, IRREVERSIBLE) later if perf on large trees bites.

### Code markers

`// TODO(ADR): Q-2026-06-04-313` at `copyTree` in `glue/fs-ops.ts`.

## Q-2026-06-04-314: binary files open read-only via a NUL-byte sniff

**Status:** 🟢 Active
**Encountered in:** ADR-0075 (open-file flow)
**Milestone:** M10 polish
**Author (agent session):** 2026-06-04

### Context

Opening an arbitrary VFS file in Monaco would garble binaries. Provisional heuristic: if a NUL byte appears in the first 8 KB, open a read-only "binary file" placeholder instead of decoding. Known-imperfect (UTF-16 text false-positives; NUL-free binaries slip through). Reversible: replace with a proper content-type detector later.

### Code markers

`// TODO(ADR): Q-2026-06-04-314` at the binary sniff in the open-file path.

## Q-2026-06-04-315: bottom panel ships Console-only (PROBLEMS tab deferred)

**Status:** 🟢 Active
**Encountered in:** ADR-0075 (bottom panel)
**Milestone:** M10 polish
**Author (agent session):** 2026-06-04

### Context

The VSCode-faithful proposal included a PROBLEMS tab fed by Monaco markers. It is not one of the four asks, so v1 ships a single Console panel (the relocated terminal). Reversible: add a read-only PROBLEMS tab (from `monaco.editor.getModelMarkers`) as a follow-up — the bottom panel is already a tabbable container.

### Code markers

(none — a deferred non-goal recorded in ADR-0075's "Alternatives considered"; no provisional code to mark.)

## Q-2026-06-03-307: eager vs lazy OPFS content preload in `OpfsFsSync.init`

**Status:** 🟢 Active  
**Encountered in:** ADR-0072 (OPFS sync content cache + async write-through), making the A-004 OPFS round-trip e2e pass  
**Milestone:** M0 acceptance / M10 follow-up  
**Author (agent session):** 2026-06-03

### Context

ADR-0072 added a synchronous content cache to `OpfsFsSync` so `fs.writeFileSync` / `fs.readFileSync` succeed on a brand-new path without an async sync-access-handle open. To make reads synchronous **after a page reload**, `init()` preloads every indexed file's bytes from the paired async OPFS surface into the cache (`preloadContent()`) — O(total persisted bytes) memory and O(files) async reads at boot.

### Options considered

- **Option A — eager full preload (shipped in ADR-0072).** Read all file bytes at `init()`. Pro: every post-reload `readFileSync` is synchronous with zero extra plumbing; trivially correct. Con: O(total bytes) memory + O(files) reads at boot; could be slow/heavy for a large persisted tree (e.g. a full `node_modules` from M10 integration).
- **Option B — lazy per-file preload.** Cache on first sync access, pre-warmed by an async pass the worker awaits before serving eval. Pro: bounded boot cost. Con: needs a deterministic "warm the working set before first eval" handshake to keep the *first* post-reload read synchronous; more plumbing.

### Decision taken (provisional)

Ship Option A. The e2e/playground working set is tiny, and eager preload is the minimal change that makes post-reload reads synchronous. If a large persisted tree makes boot slow (measure during M10 integration), switch to Option B's lazy+pre-warm approach. Reversible: localized to `OpfsFsSync.init`/`preloadContent`, with no public-API or cross-package change.

`// TODO(ADR): Q-2026-06-03-307` is **not** placed in code — the decision is documented in ADR-0072's Consequences and here; marking the preload loop would add noise to a hot path with no behavioural toggle. (Per CLAUDE.md the marker is optional when the reversible decision is already captured in an ADR.)

### Code markers

(none — intentionally unmarked: the decision is captured in ADR-0072; per CLAUDE.md the marker is optional when a reversible decision is already recorded in an ADR.)

## Q-2026-06-01-305: automatic tsconfig discovery for path aliases (vs explicit `paths` option)

**Status:** 🟢 Active  
**Encountered in:** opencode GRAPH-LOAD gate, clearing the `@/account/account`
tsconfig-alias wall (ADR-0066)  
**Milestone:** M12 (opencode facade)  
**Author (agent session):** 2026-06-01

### Context

ADR-0066 added tsconfig-style path aliases to the resolver via an **explicit,
caller-supplied** `paths` option on `ModuleLoaderOptions`. The resolver does pure
pattern matching; the caller (the opencode smoke harness) reads
`packages/opencode/tsconfig.json`'s `compilerOptions.paths` and resolves the
targets to absolute patterns. The open question: should the runtime *also* offer
**automatic** tsconfig discovery — locate `tsconfig.json`, follow the `extends`
chain (opencode extends `@tsconfig/bun`), interpret `baseUrl`, and apply `paths`
with no explicit caller map?

### Options considered

- **Option A — explicit `paths` option only (shipped in ADR-0066).** Caller reads
  tsconfig and supplies the resolved map. Pro: core resolver stays small and
  Node-faithful by default; no `extends`/`baseUrl` thorns in the hot path. Con: each
  consumer (harness, future playground) writes the ~10-line tsconfig read.
- **Option B — automatic tsconfig discovery in the runtime.** Pro: a TS project
  "just works" with no caller wiring. Con: `extends`-chain resolution, `baseUrl`
  semantics, and tsconfig-with-comments parsing are non-trivial and would live in or
  beside the resolver; risk of subtle deviations from tsc.

### Decision taken (provisional)

**Chose:** A for now; B deferred until a concrete consumer (e.g. the playground's
"open a TS project" flow) needs it.

**Why:** Option B is purely additive over A — it would compute the *same* `paths`
map the caller now supplies — so deferring costs nothing and keeps the core resolver
minimal. Promote to its own ADR when a consumer actually needs zero-wiring tsconfig
discovery; it needs no superseding of ADR-0066.

### Code markers

- (none) — a deferred follow-on with **no provisional code**; ADR-0066 records
  the deferral in its Reversibility section; there is no `TODO(ADR)` marker to clean.

---

## Q-2026-06-01-306: configurable loader map + binary asset loader (vs fixed text-extension set)

**Status:** 🟢 Active  
**Encountered in:** opencode GRAPH-LOAD gate, clearing the `generate.txt` asset-import
wall (ADR-0067)  
**Milestone:** M12 (opencode facade)  
**Author (agent session):** 2026-06-01

### Context

ADR-0067 added text-asset imports for a FIXED extension set
(`.txt`/`.sql`/`.md`/`.prompt` → default export is the file contents). Two follow-ons
are deferred: (a) making the loader map CONFIGURABLE via `ModuleLoaderOptions` (a
per-project extension→loader map, like esbuild's `loader` option) instead of a
hardcoded list; (b) a BINARY asset loader for `.wasm` (and similar), which a text
loader cannot serve.

### Options considered

- **Option A — fixed text-extension set (shipped in ADR-0067).** Pro: minimal,
  covers opencode; no config surface to design. Con: a project importing a
  different text extension, or a `.wasm`, is not served.
- **Option B — configurable loader map + binary loader now.** Pro: general. Con:
  needs a designed config shape + a binary-module representation (URL? bytes?
  `WebAssembly.Module`?) that no current need pins down.

### Decision taken (provisional)

**Chose:** A; B deferred until a concrete need (a non-listed text extension, or the
`.wasm` import actually landing on a live path) appears.

**Why:** Option B is additive over A and needs real requirements to design well
(esp. the binary representation). opencode's single `.wasm` (tree-sitter) is off the
boot path; if it walls, it gets its own decision. Promote when a need is verified.

### Code markers

- None — ADR-0067 records the deferral in its Reversibility section; the fixed set
  lives in `packages/runtime-js/src/module-loader/resolver.ts` (`TEXT_EXTENSIONS`).

---

## Q-2026-05-30-061: pure-JS VFS grep marker tool (vs ripgrep-WASM)

**Status:** 🟢 Active  
**Encountered in:** F09-T2 (feature 09-tool-ceiling-marker), implementing the ONE read-only tool that marks the FEASIBLE side of the no-tool-execution (process-spawn) ceiling for the opencode facade  
**Milestone:** M12 (opencode facade)  
**Author (agent session):** 2026-05-30

### Context

The facade needs ONE working read-only tool to concretely mark where the
spawn ceiling sits. opencode's real grep tool shells out to the ripgrep
binary (`ChildProcess` spawn) — impossible in a browser/WASI realm. The
substitute must do what grep does (read bytes + match lines) WITHOUT spawning.

### Options considered

- **Option A — pure-JS recursive grep over the existing `node:fs` builtin.**
  - Pro: zero new dependency, runs entirely in-realm (no spawn), one small
    private helper + test, instantly reversible, sufficient to PROVE the
    feasible side and MARK the boundary (the feature's actual intent).
  - Con: slower on huge trees; no real ripgrep flag/output parity.
- **Option B — ripgrep-WASM via `runWasi` (the esbuild plumbing).**
  - Pro: production-grade search fidelity, fast on large trees.
  - Con: vendors a `ripgrep.wasm` artifact + build-time fetch =>
    NEW external dependency => IRREVERSIBLE (checklist rule 2); separate ADR.
- **Option C — isomorphic-git read ops as the marker instead of grep.**
  - Con: also a NEW dependency (IRREVERSIBLE) and broader than needed.

### Decision taken (provisional)

**Chose:** A

**Why:** For a ceiling-MARKER the pure-JS path is the right altitude — it
marks the line by doing exactly what opencode's read/grep tools do (read +
match) with zero spawn and zero dependency. ripgrep-WASM/isomorphic-git are
DEFERRED behind explicit ADR ratification (each is a new dep => IRREVERSIBLE);
promote only if/when the facade's search tool is exercised at scale.

### Code markers

- `packages/runtime-js/src/utils/vfs-grep.ts` (module TSDoc `TODO(ADR)` marker)

### Reversibility justification

- Public APIs affected: none — a private helper, NOT re-exported via
  `src/index.ts`, no new builtin, no resolver intercept.
- Rough cost to revert: deleting one helper + its test (<150 lines, 2 files).
- External dependencies involved: none (uses the existing `node:fs` builtin +
  the JS RegExp engine). Adopting ripgrep-WASM / isomorphic-git would be
  IRREVERSIBLE and is explicitly deferred.

### Needs human review by

End of M12.

---

## Q-2026-05-30-062: canonical FEASIBLE-vs-IMPOSSIBLE tool boundary table lives in `docs/compat/`

**Status:** 🟢 Active  
**Encountered in:** F09-T5 (feature 09-tool-ceiling-marker), writing the authoritative boundary doc that records the no-tool-execution ceiling for the opencode facade  
**Milestone:** M12 (opencode facade)  
**Author (agent session):** 2026-05-31

### Context

F09 ships ONE working read-only tool (`vfsGrep`, T2/T3) to mark the FEASIBLE
side of the spawn ceiling and a conformance test (T4) to pin the IMPOSSIBLE
side. Those proofs need a single authoritative place that records WHICH tools
are feasible (file read, search, readdir, stat, glob) vs fundamentally
impossible (bash/shell spawn, native git spawn, ripgrep BINARY, PTY). The
question is where that canonical table lives so it is discoverable and stays
the source of truth.

### Options considered

- **Option A — a `docs/compat/opencode-tool-ceiling.md`, cross-linked from the
  feasibility doc.**
  - Pro: `docs/compat/` is already the "what works / what does not" source of
    truth per CLAUDE.md, so the spawn-ceiling tool list belongs there as ❌
    entries and the read substitutes as ✅/⚠ entries; discoverable; aligns with
    the documented sources-of-truth ordering. Documentation-only.
  - Con: manually maintained until the tool layer is actually wired (not
    auto-regenerated by `pnpm compat:generate`).
- **Option B — put the table only inside `docs/opencode-rifty-feasibility-2026-05-30.md`.**
  - Pro: lower friction, co-located with the feasibility narrative.
  - Con: not in the compat source-of-truth; drifts from compat; not where a
    reader looks for "what works".
- **Option C — encode each impossible tool as a `NotImplementedError` feature
  key in the compat-matrix so `pnpm compat:generate` surfaces it.**
  - Pro: most rigorous, auto-regenerated. Con: presupposes the tool-layer
    integration instantiates those tool stubs — out of scope for the marker.

### Decision taken (provisional)

**Chose:** A

**Why:** `docs/compat/` is the documented "what works / what does not" source of
truth, so the boundary table belongs there as ✅/⚠/❌ rows, cross-linked from
the feasibility doc. Option C is the best long-term shape but presupposes the
tool-layer integration that this marker feature does not build.

### Code markers

- `docs/compat/opencode-tool-ceiling.md` (the table; no production-code marker —
  documentation-only).
- Cross-link in `docs/opencode-rifty-feasibility-2026-05-30.md` (P5 line).

### Reversibility justification

- Public APIs affected: none — documentation placement only (wording / file
  location), explicitly the "always reversible" category per CLAUDE.md.
- Rough cost to revert: deleting one doc + one cross-link line.
- External dependencies involved: none.

### Needs human review by

End of M12.

---

## Q-2026-05-30-063: pin the spawn ceiling by a conformance test (vs prose / vs end-to-end opencode)

**Status:** 🟢 Active  
**Encountered in:** F09-T4 (feature 09-tool-ceiling-marker), proving the IMPOSSIBLE side of the no-tool-execution ceiling is walled off rather than merely asserted in comments  
**Milestone:** M12 (opencode facade)  
**Author (agent session):** 2026-05-31

### Context

The facade's hard ceiling is "no process spawn / no shell". opencode's
impossible tools all bottom out in `child_process.spawn` of a real binary
(`Git.run` → `ChildProcess.make('git')`, the bash tool, the ripgrep binary).
rifty already enforces this — any command other than `node <script>` falls
through `spawnViaSameRealm` → `execScript`, surfacing `spawn <cmd> ENOENT\n`
with exit 127 (`child_process-exec.ts:54-58`) — but the boundary lived only in
prose. A regression making a non-`node` command fake-succeed would silently
re-open the ceiling.

### Options considered

- **Option A — conformance test on rifty's own spawn substrate.**
  - Pro: cheap, in-tree today, no opencode vendoring; pins the exact substrate
    every impossible tool transitively hits; goes red if any path fake-succeeds.
  - Con: not end-to-end against opencode's real `Git.run`.
- **Option B — vendor opencode and drive its real git/bash tool.**
  - Pro: highest fidelity. Con: blocked on vendoring + a full harness;
    out of scope for the marker (opencode is NOT vendored this run).
- **Option C — prose-only documentation.**
  - Con: violates the project's "tests encode contracts" + no-silent-stub rules.

### Decision taken (provisional)

**Chose:** A

**Why:** A conformance test (`git`/`bash` → ENOENT-127, never exit 0; plus
`child.stdin.write` throws `NotImplementedError`) pins the ceiling as a
behavioral contract at the substrate level. CONFORMANCE, not Node-parity:
real Node WOULD spawn `git`, so a parity diff is the wrong tool here. Asserts
on `git`/`bash` only — both always fall through, independent of the SAB /
worker-url gate (which only routes `node <script>` to the Worker path).

### Code markers

- `packages/runtime-js/src/builtins/child_process-ceiling.test.ts`
  (conformance test; no `TODO(ADR)` in production code — no production change).

### Reversibility justification

- Public APIs affected: none — a test only, no production change.
- Rough cost to revert: deleting one test file (1 file, <90 lines).
- External dependencies involved: none.

### Needs human review by

End of M12.

---

## Q-2026-05-30-101: `HttpServer.listen` options-object overload

**Status:** 🟢 Active  
**Encountered in:** F05-T1 (feature 05-effect-http-bridge), while widening `node:http` for `@effect/platform-node`  
**Milestone:** M12 (opencode facade)  
**Author (agent session):** 2026-05-30

### Context

`@effect/platform-node`'s `NodeHttpServer.layer` always drives the server
through `server.listen({ port, host }, cb)` — the options-object overload.
Node's real `http.Server.listen` accepts that form, but rifty's
`HttpServer.listen` only accepted a bare number; the options object was
assigned verbatim as `this.port` and handed to `registerPort`, so the
registry keyed on a non-number. The port was unroutable (502) while
`'listening'` still fired — a silent-bind trap. A genuine Node-parity gap,
not an Effect-specific hack.

### Options considered

- **Option A — widen `HttpServer.listen` to accept Node's options form.**
  - Pro: Node-faithful, benefits all consumers, additive (bare-number path
    byte-for-byte unchanged), single file, no new export.
  - Con: evolves the shared `node:http` surface (vs isolating Effect concerns).
- **Option B — add a separate Effect-only adapter export in `packages/net`.**
  - Pro: isolates Effect concerns from the shared http module.
  - Con: NEW cross-package public API => IRREVERSIBLE (checklist rule 1); heavier.

### Decision taken (provisional)

**Chose:** A

**Why:** Node's real `listen` accepts an options object, so widening is the
most Node-faithful, lowest-regret fix; it is purely additive and avoids a new
cross-package public symbol.

### Code markers

- `packages/net/src/http/server.ts:51` (`listen` TSDoc `TODO(ADR)` marker)

### Reversibility justification

- Public APIs affected: none added — only an existing exported method's
  accepted input shapes are widened (every existing caller still compiles and
  behaves identically). A local `ListenOptions` interface is exported from the
  same module but is not re-exported cross-package.
- Rough cost to revert: <30 lines, 1 file (`packages/net/src/http/server.ts`).
- External dependencies involved: none.

### Needs human review by

End of milestone M12.

---

## Q-2026-05-30-102: `ServerResponse` Node-style `'drain'` emission

**Status:** 🟢 Active  
**Encountered in:** F05-T3 (feature 05-effect-http-bridge), while widening `node:http` for `@effect/platform-node`  
**Milestone:** M12 (opencode facade)  
**Author (agent session):** 2026-05-30

### Context

`@effect/platform-node`'s streaming write loop in `internal/httpServer.ts`
parks on `nodeResponse.on('drain', ...)` and IGNORES `write()`'s return value
to pace a streaming response. rifty's `ServerResponse` signalled backpressure
ONLY via `write()`'s `boolean | Promise<boolean>` return and never emitted a
Node `'drain'` event, so an Effect-driven streaming response would hang
forever. Emitting `'drain'` is also the standard Node `Writable` contract any
generic Node http consumer expects.

### Options considered

- **Option A — emit a Node-style `'drain'` from `ServerResponse`, gated by a
  `_needDrain` flag.** Set `_needDrain` only when a `write()` actually returned
  the backpressure Promise (queue full); emit `'drain'` on the next
  `ReadableStream` `pull()` when gated, then clear the flag.
  - Pro: Node-faithful; additive (an extra event, `write()`'s return unchanged);
    single file; no new export; no new dep. Gating prevents spurious `'drain'`
    before any backpressure (Node only drains after `write()` returned `false`).
  - Con: a stray `'drain'` listener in some future consumer could now fire — but
    rifty's own callers do not listen for `'drain'` today, so additive-only.
- **Option B — patch `@effect/platform-node` via shadow-registry to await
  `write()`'s Promise instead of parking on `'drain'`.**
  - Pro: leaves `ServerResponse` untouched.
  - Con: couples to Effect internals, fragile across Effect beta versions;
    violates the bridge-agnostic principle (fix rifty's Node shape, not the
    consumer).
- **Option C — buffer the whole response, never stream.**
  - Con: defeats P4 LLM streaming; memory blows up on long generations.

### Decision taken (provisional)

**Chose:** A

**Why:** Emitting `'drain'` is the standard Node `Writable` contract and is what
every Node http consumer (not just Effect) expects, so it improves general
parity. Gating behind `_needDrain` keeps it from diverging from Node by firing
before any backpressure. It is purely additive and avoids coupling to Effect
internals or sacrificing streaming.

### Code markers

- `packages/net/src/http/response.ts` (`_needDrain` field TSDoc `TODO(ADR)`
  marker; `pull()` emission `TODO(ADR)` marker)

### Reversibility justification

- Public APIs affected: none added — a new `'drain'` event is emitted on the
  already-exported `ServerResponse`; `write()`'s `boolean | Promise<boolean>`
  return is unchanged. No new exported symbol.
- Rough cost to revert: <30 lines, 1 file (`packages/net/src/http/response.ts`).
- External dependencies involved: none.

### Needs human review by

End of milestone M12.

---

## Q-2026-05-24-007: Prod proxy for npm registry (reopened 2026-05-27)

**Status:** 🟢 Active (reopened — see "Reopened" note below)  
**Encountered in:** 2026-05-24 (original); reopened 2026-05-27 architecture review (`docs/follow-ups-architecture-review-2026-05-27.md` item #3)  
**Milestone:** M9 (closure)  
**Author (agent session):** 2026-05-27

### Reopened note

Originally promoted to ADR-0028 (Vercel Edge Function). The 2026-05-27
audit surfaced that the ADR was ratified without the Edge Function
source ever landing in the repo: acceptance criterion #1 (a file at
`apps/playground/api/npm-registry/[...path].ts` or equivalent) is
unmet, there is no live URL, and the playground has never been deployed
to prod. The ADR is downgraded to **Provisional** (see
`docs/adr/0028-prod-proxy-for-npm-registry.md` §Status update — 2026-05-27)
and the question restored here as the live tracker.

### Context

A `crossOriginIsolated` playground (D-001) cannot fetch
`registry.npmjs.org` directly — CORP/CORS forbids it. Dev solves this
via the Vite proxy (D-004). Prod needs an equivalent surface so
`@riftydev/npm-client.REGISTRY_BASE_URL = '/npm-registry'` resolves both
metadata and tarballs through a deployed proxy with
`Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin`
on every response.

### Options considered

- **Option A — Vercel Edge Function (provisional leading candidate).**
  Single source file in the playground deploy proxying `registry.npmjs.org`.
  Co-located with the playground; reuses the same Vercel deploy that
  serves `vercel.json` headers.
  - Pro: Zero extra infra; one provider.
  - Con: Vercel Edge Function free-tier limits may bite at scale; vendor
    lock-in on the Edge runtime.
- **Option B — Cloudflare Worker.** Same shape, hosted on Cloudflare;
  splits the deploy across two providers.
  - Pro: Generous free tier; provider diversity.
  - Con: One more deploy target to manage.
- **Option C — Self-hosted nginx + Verdaccio mirror.** Over-engineered
  for a pet project; on-call burden.

### Decision taken (provisional)

**Chose:** A — Vercel Edge Function, *as candidate*. The decision is
not ratified until the Edge Function exists, deploys, and roundtrips a
live `@riftydev/npm-client` install. Implementation TBD by the first
prod-deploy session.

**Why:** Same rationale as the original ADR-0028 promotion — co-located
with the playground deploy, < 50 lines, switching to Option B later is
a config-only change. Reopening the question keeps the gap honest.

### Code markers

(none — pre-implementation, by intent). The decision is "candidate only"
until the Edge Function lands. When the first deploy attempt opens a PR, that PR
either (a) ratifies the candidate with a fresh ADR that supersedes
ADR-0028 with concrete code references, or (b) switches to Option B/C
with a fresh ADR.

### Reversibility justification

- Public APIs affected: none — `@riftydev/npm-client` already reads
  `REGISTRY_BASE_URL`, agnostic to what the URL routes to.
- Rough cost to revert (today): zero (no code change yet).
- External dependencies involved: none until the Edge Function is
  written.

### Needs human review by

First prod-deploy session (M9 deploy closure).

---

## Q-2026-05-27-001: `process.versions.node = '22.0.0'` vs ADR-0026 honesty

**Status:** 🟢 Active  
**Encountered in:** 2026-05-26 architecture audit follow-up (runtime-js P1-4), while landing audit cleanups  
**Milestone:** M10  
**Author (agent session):** 2026-05-27

### Context

ADR-0026 ratified `process.platform = 'rifty'` and `process.arch = 'wasm'`
as the honest values — they are the de-facto rifty ABI and per-package
shims are accepted as the migration cost. The same `RiftyProcess` class
nevertheless reports `version = 'v22.0.0'` and `versions = { node:
'22.0.0', v8: '12.0.0', rifty: '0.0.0' }`. This is plausibly intentional
(many ecosystem packages branch on `process.versions.node` to enable
Node-specific code paths), but directly contradicts the ADR-0026
honesty principle. The audit flagged the inconsistency as P1-4 with no
TODO marker or open question on file.

### Options considered

- **Option A — Keep impersonation, amend ADR-0026 to carve out
  `versions.node`.**
  - Pro: Zero compat breakage. Existing packages that gate on
    `process.versions.node >= '14'` keep working.
  - Con: Splits the honesty principle into "platform/arch honest, version
    lies"; future ADR readers must hold both rules in mind.
- **Option B — Honest values everywhere.** Drop `versions.node`, expose
  `versions.rifty = '0.0.0'`, shim per-package as needed.
  - Pro: One consistent rule. Easy to explain.
  - Con: Doubles the per-package shim cost ADR-0026 already accepted,
    measured against the ~10-package budget that triggers a re-think.
    Many packages will silently take the "no Node" branch and exhibit
    confusing behaviour rather than failing loudly.
- **Option C — Keep impersonation, add a runtime warning when accessed
  via `process.version` direct (not `process.versions.node`).**
  - Pro: Surfaces the lie in noisy environments (REPL, tests) while
    keeping the compat shape for programmatic consumers.
  - Con: Noisy in legitimate paths (many packages read both). The
    warning channel risks crying wolf.

### Decision taken (provisional)

**Chose:** A — keep the current impersonation.

**Why:** Same trade-off ADR-0026 accepted for compat values; reverting
would amplify the shim cost beyond the ~10-package budget the ADR set,
and packages that branch on `versions.node` would mis-detect the runtime
without obvious failure. The honest carve-out belongs in an ADR
amendment rather than silent code drift.

### Code markers

- `packages/runtime-js/src/builtins/process.ts:90` (`version`)
- `packages/runtime-js/src/builtins/process.ts:91` (`versions`)

### Reversibility justification

- Public APIs affected: `process.version` / `process.versions` shape,
  which is read-only and already public — but the proposed reversal is a
  value change, not a structural one, so reverts are a two-line edit.
- Rough cost to revert: 2 lines, 1 file.
- External dependencies involved: None.

### Needs human review by

End of milestone M11.

---

## Q-2026-05-30-202: Loader-internal TS-strip cache — key and invalidation

**Status:** 🟢 Active  
**Encountered in:** F02-T5 (feature 02-ts-on-import-graph), while wiring the injected `transformSource` hook into `createModuleLoader`  
**Milestone:** M12 (opencode facade)  
**Author (agent session):** 2026-05-30

### Context

`loader.ts` passed `opts.transformSource` straight through with NO cache, so
the WASI esbuild process is re-spawned for the same module across the large
opencode `.ts` graph and across repeated loads within one loader instance —
each strip is a full guest process spawn (ADR-0047/0049). ADR-0052 D4
(REVERSIBLE) calls for a loader-internal `Map<id,string>` populated lazily,
read before re-invoking the hook, and cleared by the existing `invalidate(id)`
-> `registry.invalidate` path. The open sub-question: the cache KEY and the
invalidation coupling.

### Options considered

- **Option A — key by absolute resolved id; drop via the existing
  `invalidate(id)` path (full `invalidate()` clears all).**
  - Pro: installed sources are immutable for a given package version in the VFS
    overlay, so id is a sufficient key; integrates with the invalidate
    semantics that already exist for the `load-fixture` / future-HMR hot path;
    `esm.ts` stays cache-unaware (the wrap is invisible to the execute path);
    single file, no new export, no new dep.
  - Con: a file edited in place under a future HMR layer needs an explicit
    `invalidate(id)` to drop the stale strip — acceptable because invalidate
    already exists for exactly that hot path.
- **Option B — content-hash key (hash the source before stripping).**
  - Pro: correct under live in-place edits without an explicit invalidate.
  - Con: unnecessary in P0 where installed sources do not mutate; adds a hash
    per load on the hot path; the id-keyed cache already invalidates via the
    registry hook.

### Decision taken (provisional)

**Chose:** A

**Why:** Id is a sufficient key for immutable installed sources and reuses the
existing `invalidate` semantics; content-hashing buys correctness only under a
not-yet-built HMR layer at a per-load cost.

### Code markers

- `packages/runtime-js/src/module-loader/loader.ts` (`transformCache` TSDoc
  `TODO(ADR)` marker on the cache declaration and on the `invalidate` coupling)

### Reversibility justification

- Public APIs affected: none — purely internal to `createModuleLoader`; no new
  export, no signature change. Callers and plain-JS loaders are unaffected.
- Rough cost to revert: <20 lines, 1 file (`loader.ts`).
- External dependencies involved: none.

### Needs human review by

End of milestone M12.

---

## Q-2026-05-31-201: `ts-esm` parity Node reference — full transform (tsx) vs strip-only Node

**Status:** 🟢 Active  
**Encountered in:** F02-T7 (feature 02-ts-on-import-graph), wiring the gold cross-file `.ts` parity case  
**Milestone:** M12 (opencode facade)  
**Author (agent session):** 2026-05-31

### Context

The gold parity case (`ts-graph-cross-file.case.ts`) exports an `enum` — the
exact construct ADR-0052 Spike A validated rifty's esbuild hook lowers (to a
self-referential IIFE). But Node v24's built-in `--experimental-strip-types`
(the harness's prior `ts-esm` Node reference on Node >= 23) is *strip-only*: it
throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on any TS needing runtime codegen
(`enum`, parameter properties, runtime `namespace`). So the Node strip-only
reference diverges from rifty on a Node *limitation*, not a rifty behaviour —
the wrong reference for a full-transform vs full-transform parity proof.

### Options considered

- **Option A — always run the `ts-esm` Node side through a FULL TS transform
  (the vendored `tsx`), regardless of Node major version.**
  - Pro: apples-to-apples — rifty's esbuild hook is also a full transform, so
    both sides lower `enum`/parameter-properties identically; the gold case can
    use the enum the task + ADR-0052 require; `tsx` is already a devDependency
    and was already the harness's `< 23` fallback (no new dep); the existing
    type-only `ts-strip-smoke` case stays green (tsx prints `42` too).
  - Con: no longer exercises Node's *native* strip-only path, so a future
    rifty-emits-something-strip-only-rejects divergence would not be caught by
    parity (it is not the contract under test — the contract is full-transform
    semantics).
- **Option B — keep strip-only Node and forbid codegen-requiring TS in cases.**
  - Pro: tests against Node's shipped default loader.
  - Con: cannot host the gold case's `enum` at all (task + ADR-0052 require it);
    would silently narrow the gold case to type-only erasure and drop the
    enum-lowering coverage that is the whole point of "TS-on-import" (not just
    type-erase-on-import).

### Decision taken (provisional)

**Chose:** A

**Why:** rifty's transform is a full TS transform; the only honest parity
reference is a full TS transform (tsx). Strip-only Node is a strict subset that
rejects the enum the gold case must prove rifty lowers, so it is the wrong
reference, not a stricter one.

### Code markers

- `tools/node-parity-runner/src/run-in-node.ts` (`nodeRunnerFor` `TODO(ADR)`)
- `tools/node-parity-runner/src/types.ts` (`ts-esm` kind TSDoc `TODO(ADR)`)

### Reversibility justification

- Public APIs affected: none — `run-in-node.ts`/`types.ts` are a `tools/` parity
  harness, not a package public API; no `src/index.ts` surface changes.
- Rough cost to revert: <20 lines, 2 files (restore the `NODE_MAJOR < 23`
  branch and the two TSDoc blocks).
- External dependencies involved: none new — `tsx` is an existing devDependency
  already used as the harness's prior strip-types fallback.

### Needs human review by

End of milestone M12.

---

## Q-2026-05-31-301: WASM-SQLite persistence scope — in-memory-first vs OPFS-`SyncAccessHandle`

**Status:** 🟢 Active  
**Encountered in:** the `node:sqlite` `DatabaseSync` shim (ADR-0065), feature 04 (now P2)  
**Milestone:** M12 (opencode facade)  
**Author (agent session):** 2026-05-31

### Context

ADR-0065 ratifies `sql.js` (synchronous, in-memory) as the first-cut engine
behind the rifty `node:sqlite` `DatabaseSync` builtin, because opencode boots via
`OPENCODE_DB=:memory:` and a synchronous engine matches `@effect/sql-sqlite-node`'s
`DatabaseSync` usage. Durable cross-reload persistence (via
`@sqlite.org/sqlite-wasm` + OPFS `SyncAccessHandle`) is the open scope question:
when does it land, and does the first cut need ANY durability?

### Options considered

- **Option A — in-memory-only first cut; OPFS persistence is a later follow-up
  (chosen).**
  - Pro: minimal — `sql.js` in-memory is the smallest thing that boots the layer
    DAG; no COI/SAB dependency beyond ADR-0002's existing mandate; durability is
    not on the boot/first-light path (opencode's own boot tests use `:memory:`).
  - Con: no cross-reload durability; the P4 persistence criterion (Q-2026-05-30-114)
    degrades to same-process read-back until the OPFS follow-up.
- **Option B — adopt `@sqlite.org/sqlite-wasm` + OPFS up front.**
  - Pro: durable from the start; aligns with ADR-0006 source #4.
  - Con: the official build's ergonomic surface is async/OO and its persistent
    variant requires OPFS + a Worker + COI — fights the synchronous `DatabaseSync`
    boot need; far larger first cut; interacts with ADR-0002 immediately for no
    boot benefit.

### Decision taken (provisional)

**Chose:** A — in-memory-first `sql.js`; OPFS persistence DEFERRED to a follow-up
that adopts `@sqlite.org/sqlite-wasm` + `SyncAccessHandle` and does its own
COI/SAB analysis (ADR-0002).

**Why:** the proven need (Spike C) is a *synchronous* engine that opens
`:memory:`, tolerates `PRAGMA journal_mode=WAL`, and runs the migration DDL at
boot. Durability is not on that path. Picking the synchronous in-memory engine
now keeps the irreversible commitment minimal and honest.

### Code markers

- `TODO(ADR): Q-2026-05-31-301` at the `node:sqlite` shim's `:memory:`/in-memory
  backing site (the persistence-scope seam).

### Reversibility justification

- Public APIs affected: none beyond the `node:sqlite` builtin surface ADR-0065
  already ratifies; the in-memory-vs-OPFS choice is an internal backing-store
  decision behind that surface.
- Rough cost to revert / change scope: switching to OPFS is an additive
  follow-up (a new engine + a VFS-backed handle), not a revert of the shim
  surface.
- External dependencies involved: the OPFS follow-up would ADD
  `@sqlite.org/sqlite-wasm` (itself IRREVERSIBLE — gated here, not adopted now).

### Needs human review by

End of milestone M12.

---

## Q-2026-05-31-302: exact `node:sqlite` builtin registration module path

**Status:** 🟢 Active  
**Encountered in:** the `node:sqlite` `DatabaseSync` shim (ADR-0065), feature 03/04  
**Milestone:** M12 (opencode facade)  
**Author (agent session):** 2026-05-31

### Context

ADR-0065 D3 registers the `sql.js`-backed `DatabaseSync` shim as a rifty
`node:sqlite` builtin but does not pin the registration module path. The prior
draft Q-2026-05-30-102 favoured a harness-local side-effect module (mirroring
`net/register-builtins.ts`) scoped to the opencode load, to avoid leaking the
specifier into all loads / the wrong layer. The corrected framing
(`node:sqlite`, not `bun:sqlite`) does not change that placement reasoning.

### Options considered

- **Option A — harness-local / shadow-registry side-effect module, imported only
  by the opencode harness (chosen, consistent with Q-2026-05-30-102).**
  - Pro: scoped to the opencode load; matches the `net`/`https` registration
    precedent; keeps `node:sqlite` out of unrelated default loads; correct layer.
  - Con: the registration site is harness-local, so a non-opencode consumer
    wanting `node:sqlite` would need its own registration.
- **Option B — register from `runtime-js/builtins/index.ts` (always-on).**
  - Pro: `node:sqlite` available to every load without a harness import.
  - Con: leaks a heavy WASM-SQLite engine into ALL loads; wrong layer / scope for
    a single-consumer facade; contradicts the feature-03 scoping intent.

### Decision taken (provisional)

**Chose:** A — harness-local/shadow-registry registration scoped to the opencode
load, via the existing `registerBuiltin` extension point. Exact filename within
that area is an always-reversible file-structure detail.

**Why:** consistent with the ratified-by-precedent `net`/`https` registration
pattern and the feature-03 scoping intent; keeps the engine out of default loads.

### Code markers

- `TODO(ADR): Q-2026-05-31-302` at the `node:sqlite` builtin registration module.

### Reversibility justification

- Public APIs affected: none new — additive registration via the existing
  `registerBuiltin` extension point from a harness-local module.
- Rough cost to revert / move: ≤2 files, <30 lines (relocate the registration
  call); no cross-package API change.
- External dependencies involved: none beyond `sql.js` (ratified separately in
  ADR-0065); the registration vehicle adds none.

### Needs human review by

End of milestone M12.

---

## Q-2026-05-31-303: `node:sqlite` parity case lands with the `DatabaseSync` shim, not the engine-init task

**Status:** 🟢 Active  
**Encountered in:** the `sqlite-wasm-init` task (ADR-0065) — engine-init only  
**Milestone:** M12 (opencode facade)  
**Author (agent session):** 2026-05-31

### Context

The `sqlite-wasm-init` task delivers ONLY the sql.js engine bridge
(`initSqliteEngine`/`getSqliteEngine`/`isSqliteEngineReady` in
`packages/net/src/sqlite/engine.ts`) — it does NOT yet add the
`DatabaseSync`-shaped facade nor register the `node:sqlite` builtin
(Q-2026-05-31-302). The task's "parity environment" note asks for a head-to-head
parity-runner case (Node `DatabaseSync` vs rifty shim), but the parity runner
compares **stdout of user code** running `node:sqlite`, and the rifty side has
no `node:sqlite` specifier to resolve until the shim is registered. The runner
also has no `'sqlite'` `kind`/registration mode (it has `cjs`/`esm`/`http`/
`ts-esm`). A parity case here would have nothing real to exercise on the rifty side.

### Options considered

- **Option A — defer the head-to-head parity case to the `DatabaseSync` shim
  task; cover the engine bridge with the mandated unit test now (chosen).**
  - Pro: the unit test (`engine.test.ts`) proves the load-bearing init contract
    (memoised async bring-up → synchronous handle; throw-before-init) which is
    exactly what this task delivers; no fake/empty parity case; the parity case
    lands when there is a real `node:sqlite` surface to diff against Node.
  - Con: no Node-vs-rifty diff lands in THIS commit (it lands one task later).
- **Option B — add a `'sqlite'` parity mode + register `node:sqlite` now, just to
  host a parity case.**
  - Pro: a parity case lands in this task.
  - Con: pulls the `DatabaseSync` facade + builtin registration (the next task's
    scope, Q-2026-05-31-302) into the engine-init task; violates one-concept-
    per-commit; the registration-path decision is still provisional.

### Decision taken (provisional)

**Chose:** A — engine-init covered by its unit test now; the Node `DatabaseSync`
vs rifty-shim parity case is written with the `DatabaseSync` shim task (where the
`node:sqlite` specifier actually resolves on the rifty side). ADR-0065's
"Consequences" already mandates that parity/conformance case against the real
surface; this just sequences it to the task that creates the surface.

**Why:** the parity runner needs a real `node:sqlite` rifty surface to diff;
that surface is the next task. Writing a hollow case now would be a no-op on the
rifty side (no honest comparison) and would drag the next task's scope in early.

### Code markers

- None in code (sequencing note only). The engine bridge is exercised by
  `packages/net/src/sqlite/engine.test.ts`.

### Reversibility justification

- Public APIs affected: none — purely a test-sequencing decision.
- Rough cost to revert: write the parity case in this task instead (requires
  pulling the shim/registration forward); ≤1 new case file once the surface
  exists. No cross-package API change.
- External dependencies involved: none beyond `sql.js` (ADR-0065).

### Needs human review by

End of milestone M12.

---

## Q-2026-05-31-304: TS-on-import decorator lowering — esbuild flag pass-through vs acorn decorators plugin vs leave-as-gap

**Status:** 🟢 Active  
**Encountered in:** WIRE task (opencode module-loader integration), item 3 — confirming the `transformSource` hook handles the TS-only syntax effect leans on  
**Milestone:** M12  
**Author (agent session):** 2026-05-31

### Context

The cross-file TS parity case (`modules/ts-effect-syntax-cross-file`) proves the
real esbuild WASI `transformSource` hook erases/lowers `import type`, `const enum`,
`interface`, `enum`, and `satisfies` identically to the Node-side `tsx` reference.
Decorators are the exception: esbuild with `--loader=ts` and no tsconfig leaves
stage-3 `@decorator` syntax UN-lowered (passthrough), and rifty's post-strip acorn
parse (`ecmaVersion:'latest'`, no decorators plugin) then throws a SyntaxError —
while `tsx` fully lowers decorators. opencode's vendored source uses NO decorators
(verified by grep), so this is not a boot blocker, but a real pipeline gap.

### Options considered

- **Option A:** Leave it as a documented gap (compat-matrix + this entry); add real
  decorator support only when a target package needs it.
  - Pro: zero risk now; decorators are off opencode's path; honest (no faked test).
  - Con: a future package using decorators would hit an opaque acorn SyntaxError.
- **Option B:** Pass esbuild a tsconfig enabling `experimentalDecorators` (or the
  stage-3 decorator transform) so the strip step lowers `@decorator` before acorn.
  - Pro: closes the gap at the natural seam (the transform already runs).
  - Con: `experimentalDecorators` vs stage-3 semantics differ; choosing the wrong
    one silently miscompiles; needs a parity case per decorator flavour.
- **Option C:** Add an acorn decorators plugin so the AST rewriter parses the
  passthrough `@decorator`.
  - Pro: no esbuild config change.
  - Con: acorn would parse but NOT lower — decorators would still not execute
    correctly; strictly worse than B.

### Decision taken (provisional)

**Chose:** A

**Why:** Decorators are not on opencode's source-transform path; faking a green
parity case would be dishonest, and lowering them correctly (B) is a separable
decision better made against a concrete package that needs it.

### Code markers

- `tools/node-parity-runner/cases/modules/ts-effect-syntax-cross-file.case.ts` (NOTE block)
- `docs/compat/modules.md` (Known limitations — TS-on-import decorators)

### Reversibility justification

- Public APIs affected: none — the gap is in the `tools/` parity harness +
  `transformSource` configuration, not a cross-package API.
- Rough cost to revert/close: adding the esbuild decorator flag is a one-line
  arg change in `transformWithEsbuild` callers + one parity case; <2 files.
- External dependencies involved: none (esbuild is already vendored).

### Needs human review by

End of milestone M12.

---

## Q-2026-06-07-411: grep/find frozen-GNU fixtures deferred; ls --color/-l not byte-fixtured

**Status:** 🟢 Active · **Encountered in:** ADR-0093(b) vs landed ls/grep/find · **Milestone:** M10/M11 · **Author:** 2026-06-07

ADR-0093(b) wants frozen-GNU golden fixtures as the oracle for ls/grep/find. Landed this phase: `ls` byte-frozen vs `gls` (GNU coreutils 9.7) for default/-a/-A/-1/-r listing (`packages/shell/fixtures/ls/`). NOT fixtured (recorded — no silent cap): (1) grep — `ggrep` not installed → 22 hand-asserted conformance tests; (2) find — `gfind`/findutils not installed (box aliases find→bfs) → 12 conformance tests; (3) ls `--color` — gls emits leading `ESC[0m` + zero-padded `01;34` vs our `ESC[1;34m`, structural assert only; (4) ls `-l` metadata (perms/owner/nlink) — fixed placeholders per ADR-0050 (VFS has no real perms), structural regex only.

### Provisional decision

Defer grep/find byte-fixtures to the milestone-DoD closer: capture via `brew install grep findutils` (→ ggrep/gfind, `LC_ALL=C`, version+locale header) or a Linux box, then add fixture tests mirroring `ls-fixtures.test.ts`. ls `--color`/`-l` stay structurally-asserted unless real SGR-LS_COLORS / perms ever land. REVERSIBLE (test infra only).

### Code markers

(none — fixtures not yet captured; mark grep.ts/find.ts/ls-fixtures.test.ts when frozen golden cases land.)

---

## Q-2026-06-07-412: minor GNU usage-error fidelity in find/ls (polish)

**Status:** 🟢 Active · **Encountered in:** adversarial review of landed find/ls · **Milestone:** M10 polish · **Author:** 2026-06-07

Review flagged 3 usage-error fidelity nits — NOT silent stubs, NOT hard-rule breaches (all loud), just mis-shaped vs GNU: (1) `find -name` with a MISSING value silently sets name='' (empty regex → no output, exit 0) instead of GNU `find: missing argument to '-name'`; (2) `find -type` missing value throws `NotImplementedError('shell.find.-type')` — loud but mislabels a usage error; (3) `ls --color=WHEN` with invalid WHEN writes a GNU-style stderr line then throws NotImplementedError — should be a GNU usage error (exit 2), not not-implemented.

### Provisional decision

Low-priority polish: convert these three to GNU usage errors (stderr + exit 2/1, no throw) when next touching find/ls. Not blocking — current behavior is loud and safe. REVERSIBLE (local error-path tweaks, <1 file each).

### Code markers

(none — fix not yet applied; mark find.ts (-name/-type arg parse) + ls.ts (--color parse) when the usage-error shaping lands.)

---

## Template

```markdown
## Q-YYYY-MM-DD-NNN: <Short title>

**Status:** 🟢 Active  
**Encountered in:** PR #X, while implementing <feature>  
**Milestone:** M<N>  
**Author (agent session):** <date or session marker>

### Context

<2-4 sentences about what came up and why it's unclear>

### Options considered

- **Option A:** <description>
  - Pro: ...
  - Con: ...
- **Option B:** <description>
  - Pro: ...
  - Con: ...

### Decision taken (provisional)

**Chose:** <A or B>

**Why:** <1-2 sentences>

### Code markers

- `src/path/to/file.ts:42`
- `src/another/file.ts:117`

### Reversibility justification

<Why is this reversible? Answer:
- What public APIs are affected? (should be none)
- What's the rough cost to revert? (should be <100 lines / <2 files)
- Are any external dependencies involved? (should be no)>

### Needs human review by

End of milestone M<N>.
```

---

## Promoted

- **Q-2026-05-23-001** — *Identifier rewriter strategy for ESM live bindings* —
  promoted to **ADR 0009** (`docs/adr/0009-ast-based-esm-transform.md`). The
  provisional regex/zone-scanner approach was replaced with an AST-based
  rewriter using `acorn` + scope tracking after the regex approach broke for
  real Vite's pre-bundled deps (parameter-shadowing of an imported name).
- **Q-2026-05-23-002** — *Realm where toolchain dev-servers run* — promoted to **ADR 0025** (`docs/adr/0025-toolchain-dev-server-realm.md`). Main-thread realm ratified for M10 Dev Mode and Real Vite; a future Worker + cross-realm bridge remains the right long-term answer (M10 follow-up).
- **Q-2026-05-23-003** — *`process.platform` / `process.arch` honest values vs compat lies* — promoted to **ADR 0026** (`docs/adr/0026-process-platform-honest-values.md`). `'rifty'` / `'wasm'` confirmed as the de-facto public ABI; per-package shim cost accepted; revisit at ~10 shimmed packages.
- **Q-2026-05-23-004** — *File-level shim overlay vs full-package shadow* — promoted to **ADR 0027** (`docs/adr/0027-file-level-shim-overlay.md`). Per-file overlay in the consuming adapter kept until a third shim site appears, at which point the pattern moves into `@riftydev/npm-client/shims/`.
- **Q-2026-05-23-005** — *Expanded `@riftydev/runtime-js` public surface via `./builtins/*` subpath exports* — promoted to **ADR 0018** (`docs/adr/0018-runtime-js-subpath-exports.md`). Retroactive accept; consolidation to a `./host` entry remains an option for the next public-API review.
- **Q-2026-05-24-007** — *Prod proxy for npm registry* — promoted to **ADR 0028** (`docs/adr/0028-prod-proxy-for-npm-registry.md`); **reopened 2026-05-27** when the audit found the Edge Function source had never landed (see Active section above and ADR-0028 §Status update — 2026-05-27). The Vercel Edge Function candidate is provisional pending implementation.
- **Q-2026-05-27-003** — *WASI preopens — explicit `cwd` and ordering semantics* — promoted to **ADR 0049** (`docs/adr/0049-wasi-cwd-and-atfdcwd-preopen-semantics.md`). esbuild (restored as the forcing consumer by ADR-0047, which reversed ADR-0044's swc substitution) ran through `runWasi` and pinned Option A — `WasiOptions.cwd?: string`. Running it also forced `AT_FDCWD` resolution, directory-open in `path_open`, and `fd_readdir` → `E_NOTDIR` on a file fd, plus wiring the `stdin` option. All in ADR-0049.
- **Q-2026-05-25-touch-utimes** — *Where should `utimes` live on the sync VFS surface?* — promoted to **ADR 0029** (`docs/adr/0029-utimes-on-fs-sync.md`). The trigger condition fired: a second caller (`node:fs.utimesSync` in `runtime-js`) appeared, so the provisional Option B (backend-sniffing in `shell`) was escalated to Option A — `FsSync.utimes` lives on the interface, `MemoryFsSync` mutates the shared backend, `OpfsFsSync` records into an in-memory side-table (`FileSystemSyncAccessHandle` has no mtime mutation). `shell/src/builtins.ts` drops its `@riftydev/vfs/internal` import.
- **Q-2026-05-27-002** — *Coherent `OwnerResolver` + readiness-registry swap* — promoted to **ADR 0046** (`docs/adr/0046-preview-owner-binding.md`). The "defer until a second consumer" decision (Option B) paid off: A-023 (SW→Worker direct routing) arrived as the second consumer, so the `PreviewOwnerBinding` seam was designed from both the window and worker shapes at once — `FirstWindowOwnerBinding` (legacy path preserved byte-for-byte) and `WorkerOwnerBinding` (port-keyed routing + the `'gone'` outcome for the no-`pagehide` worker lifecycle trap). The worker readiness frame's `ports` field is additive optional, so no `SW_FRAME_VERSION` bump (ADR-0040/ADR-0031). **The cross-deferral streaming-wire-frame sibling is resolved by ADR-0048 (Q-2026-05-29-001, promoted).**
- **Q-2026-05-29-001** — *Streaming cross-realm preview wire-frame* — promoted to **ADR 0048** (`docs/adr/0048-streaming-cross-realm-preview-wire-frame.md`). Deliberated via a design panel + adversarial review (2026-05-29). Key correction: the bump is a **net-local `PREVIEW_PORT_FRAME_VERSION`** (`@riftydev/net`), NOT `SW_FRAME_VERSION` — bumping the latter would be a sibling/reverse import and would invalidate the unrelated SW↔page hop. Four additive `reply-stream-*` frames, buffered `reply` kept as fallback, **per-request** (not per-channel) reply-mode selection, no-progress idle timeout with single-map cleanup. Implemented in `packages/net/src/cross-realm/preview-port.ts`.
- **Q-2026-05-29-002** — *No-symlink `fs.realpath`/`fs.lstat` semantics* — promoted to **ADR 0050** (`docs/adr/0050-no-symlink-realpath-lstat-semantics.md`). Resolved via a dedicated deliberation agent (adversarial M12-forward-compat check). Reverses the prior `NotImplementedError` loud-throw: for the symlink-free VFS, `lstat ≡ stat` and `realpath ≡ normalise-if-exists` are the CORRECT POSIX semantics (no-silent-stubs guards fake values, not the truthful canonical answer — a missing path still throws `ENOENT`). Forcing consumer: real Vite watcher (chokidar/readdirp). Contract test `packages/runtime-js/src/builtins/fs.test.ts` evolved to the stronger no-symlink contract; M12 symlink rewrite tracked by a `TODO(M12)` anchor in `fs.ts`.
- **Q-2026-05-30-001** — *Native-dependency install policy* — promoted to **ADR 0051** (`docs/adr/0051-native-dependency-install-policy.md`). Resolved via a deliberation agent (adversarial false-positive + optional-handling analysis). The installer now throws `ENATIVEUNSUPPORTED` for a package pinning `cpu` to a non-`wasm` set (a compiled artifact) with no shadow substitution; **required** natives abort, **optional** natives skip-with-warning (inherits `walkAndPin`'s existing optional catch — so esbuild's `@esbuild/*` platform optionals skip and Vite still installs). Forcing consumer: `opencode-ai` (native binary → can't run by design). New `docs/compat/incompatible-packages.md`. `cpu`-keyed (not `os`) to avoid false-positives.

---

## Rejected

- **Q-2026-05-23-006** — *`node:https` aliased to `node:http`* — **rejected** in favour of a loud `NotImplementedError`-throwing stub (ADR 0010). Silent stub violated the "no silent stubs" hard rule. Vite's defensive top-level import still works because import-time doesn't trigger the throw.
