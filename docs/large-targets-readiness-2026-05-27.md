# Large-target readiness — express / vite / opencode

What it takes to run each of three reference targets end-to-end in the
playground. Snapshot taken 2026-05-27 after the follow-ups triage session
(see `docs/follow-ups-2026-05-27.md`). Each task references either an
existing milestone open-acceptance item, a follow-ups doc item, or names a
new ticket inline.

Targets ordered by ascending difficulty:

- **Express** — Node HTTP server with ~50 transitive deps.
- **Vite** — Express + esbuild.wasm + cross-realm HMR + bigger graph.
- **OpenCode** — everything above + complex CLI shape + real-TCP streaming
  + likely native-dep shims.

## Critical first step — settles the rest

- [x] **Run the opt-in live express install** (`tests/integration/express-live.opt-in.test.ts`).
  - Invocation: `RIFTY_LIVE_REGISTRY=https://registry.npmjs.org pnpm vitest run express-live.opt-in`.
  - Outcome A — succeeds: M9 closure stays on its current path; M11 nested install remains a follow-on.
  - Outcome B — `EVERSIONCONFLICT`: capture the offending pair from `err.packageName` / `firstVersion` / `secondVersion`. M11 **nested install becomes a prerequisite for M9 closure**, not a follow-on. Express, Vite, and OpenCode all gate on it.
  - Refs: `docs/follow-ups-2026-05-27.md` item #1, ADR-0023, ADR-0028.
  - **Outcome (2026-05-27 second pass): Outcome B** — `EVERSIONCONFLICT` on `ms: 2.1.3 vs 2.0.0` after fixing three latent installer bugs that the first pass surfaced (algorithm-aware integrity for sha512; partial-range semver for `^4`; removal of the silent `dist-tags.latest` fallback). The `ms` conflict is the classic express ↔ debug diamond, so we now know **M11 nested install is required** before any of the three large targets land. The blocker rows below have been updated accordingly.

## Express

Smallest target. M7 (net + http + SW preview) already delivers
`http.createServer().listen(3000)` end-to-end through the playground.

### Hard blockers

- [x] **#1 outcome** (above) — ran 2026-05-27 second pass; settled to Outcome B.
- [x] **M11 nested install — LANDED 2026-05-27.** ADR-0042 ratified the first-wins-flat + nest-on-conflict placement; `walkAndPin` was rewritten; `ResolvedPackage.installPath` + lockfile-keyed-by-path shipped. The opt-in live `express@^4` install now succeeds end-to-end (86 packages; `ms × 5`, `debug × 3`, `statuses × 3` on disk + lockfile). M9 open-acceptance "Nested install for version conflicts" closes here.

### Soft blockers (UX, not function)

- [x] **Follow-ups #15 — `npm install` at the shell prompt (done 2026-05-27).**
  - `apps/playground/src/glue/npm-shell-command.ts` registers an `npm` builtin on the long-lived shell session. `install` / `i` / `add` subcommands; name, `name@range`, scoped specs; auto-create + merge `package.json`; EVERSIONCONFLICT / EINTEGRITY / EBROKENLOCK error mapping. The `node` builtin is still deferred (OpenCode-class — pairs with `execSync` SAB+Atomics).
  - Per-package fetch progress is start/end + summary today; a streaming hook on `install()` is the next refinement.

### Not blocking

- #9, #11, #14, #16, #17, #20, #23 — internal ergonomics, zero express impact.

## Vite

Express requirements + dev-server transformation + cross-realm HMR.

### Hard blockers

- [x] **#1 outcome** + **M11 nested install** — both landed 2026-05-27. The ms-class diamonds Vite triggers are handled by the new placement algorithm; the remaining Vite-specific work is dev-server transformation + cross-realm HMR (the rows below).
- [ ] **M8 — vendor `esbuild.wasm` end-to-end through the WASI runner.** Currently the M10 dev-server has no TS/JSX transformation path. M8 open acceptance.
  - [ ] **Follow-ups #24 — WASI preopens `cwd` + ordering semantics.** Currently `OPEN_QUESTIONS Q-2026-05-27-003`. esbuild expects a working directory; the right API shape (option A: `cwd?: string`; option B: ordered array; option C: both) gets decided when esbuild is the concrete consumer.
- [ ] **Cross-realm HMR / Vite-in-Worker** — M10 open acceptance ("Vite-in-Worker per ADR-0011") + ADR-0025 dev-server-realm split.
  - [ ] **Follow-ups #6 — `PreviewOwnerBinding` interface** (currently `OPEN_QUESTIONS Q-2026-05-27-002`). Pairs the SW `OwnerResolver` swap with the readiness registry; both halves move together when `WorkerOwnerResolver` lands.
  - [ ] **Follow-ups #8 — extract `realVite.ts` phase helpers.** Pure refactor for the worker-realm fork; lands alongside the realm swap.

### Soft blockers

- [x] **Follow-ups #15** — landed 2026-05-27 (see Express section above). `npm install vite` at the prompt now works the same way as `npm install express`.
- [ ] **Shadow-registry consolidation** (M10 open acceptance, ADR-0015) — move `overrides.ts` + shim files under `tools/shadow-registry/`. Needed at scale once Vite drags in packages we have to shim.

### Not blocking

- #9, #11, #14, #16, #17, #20, #23 — same as Express.

## OpenCode

Hardest target. Express + Vite requirements + CLI shape + real-TCP-shaped
streaming + likely native-dep shims.

### Hard blockers

- [ ] **All Express + Vite hard blockers.**
- [x] **M11 nested install** — landed 2026-05-27. OpenCode's diamonds now resolve the same way express's do.
- [ ] **`node script.ts` from shell prompt.**
  - [ ] **Follow-ups #15** — npm landed 2026-05-27; the `node` builtin is still open and pairs with `execSync` SAB+Atomics below.
  - [ ] **`execSync` via SAB+Atomics** (ADR-0011 phase 3, M6 open acceptance) — needed if OpenCode (or any of its tooling) uses `execSync` for sub-process orchestration.
- [ ] **Real-TCP `WebSocket` / cross-realm WebSocket bridge** — M7/M10 open acceptance ("Cross-realm WebSocket bridge"). The in-process WS layer satisfies in-realm HMR; outbound long-lived connections to claude.ai or other services need either a real transport or a SW-mediated `fetch` upgrade.
- [ ] **Native dep policy.** OpenCode likely pulls a package with a native (node-gyp) binding somewhere in its graph. We don't support native; the install must either:
  - Find a pure-JS shim in shadow-registry (ADR-0015), or
  - Throw loudly with a clear "native not supported" message — capture in a new follow-up ticket once the first concrete native dep is identified.
- [ ] **`child_process.spawn` over Worker stdio (real stdin path).**
  - The kernel handle now exposes `stdin()` (follow-ups #3, this session). Wiring it through `ChildProcess.stdin` so OpenCode can pipe data into sub-tools is open work — currently `ChildProcess.stdin.write` throws (ADR-0011, M6 open acceptance "`ChildProcess.stdin` IPC").

### Soft blockers

- [ ] **Follow-ups #22 — shell pipes via `@rifty/io` streams (M12).** Relevant if OpenCode invocations use `| jq …`, `2>&1 | tee log`, etc. Currently `runSegment` returns a buffered `RunResult`; pipes throw `NotImplementedError`.
- [ ] **Follow-ups #15** — same shell-prompt UX gap.

### Not blocking

- #9, #11, #14, #16, #17, #20, #23 — same as Express + Vite.

## Items that affect none of the three targets

These deferred items are pure internal ergonomics. They can land any time
without unblocking any of the three large targets:

- **#5** — explicit `installCoreBuiltins` (pairs with M11 multi-realm boot).
- **#9** — `useRuntime` demote (no reactive consumer today).
- **#11** — `createInstaller` factory (DI ergonomics).
- **#14** — `readable.ts` split (file budget removed, no current pressure).
- **#16** — terminal `LineDiscipline` (no TUI target).
- **#17** — `terminal.stdin` ReadableStream (no consumer).
- **#20** — `NotImplementedError` cross-layer (zero current catch sites; option B accepted).
- **#23** — `WasiContext` split (test ergonomics, pairs with M8).

## Suggested execution order

1. ✅ **2026-05-27** — ran the opt-in express install (#1). Outcome B: `EVERSIONCONFLICT` on `ms`. Three latent installer bugs (sha256-only integrity, partial-range semver, silent latest fallback) were fixed in the same session to even get the gating signal.
2. ✅ **2026-05-27** — landed **#15** (`npm install` at the prompt). Closes the prompt-install UX gap for all three targets.
3. ✅ **2026-05-27** — landed **M11 nested install** (ADR-0042: first-wins-flat + nest-on-conflict). Live `express@^4` now installs end-to-end (86 packages, including `ms × 5`). Express is **unblocked** at the install layer.
4. **M8 esbuild.wasm + #24** — required for any vite-class target. Unblocks both Vite and OpenCode. Next-session priority.
5. **M11 cross-realm work (#6, #8, ADR-0025 follow-up, WebSocket bridge)** — required for Vite-in-Worker and OpenCode-class streaming.
6. **Native-dep policy + shadow-registry consolidation** — surfaces during real install attempts; concrete shim list grows from there.
7. **Lockfile fast-path replay for nested entries** — ADR-0042 deferred this; install of a nested-entry-bearing project currently bypasses the lockfile fast-path. Bounded perf cost (live resolve + cache); follow-on slice when needed.

## References

- `docs/follow-ups-2026-05-27.md` — 24-item triage with per-item Decision lines.
- `OPEN_QUESTIONS.md` — Q-2026-05-27-002 (preview owner binding), Q-2026-05-27-003 (WASI cwd).
- `TASKS.md` — milestone open-acceptance gaps referenced inline above.
- `PROJECT_PLAN.md` — D-001..D-007 decisions log.
- `docs/adr/0011-spawn-worker-as-process.md`, `0023-lockfile-reuse.md`, `0025-toolchain-dev-server-realm.md`, `0028-prod-proxy-for-npm-registry.md`, `0041-readdir-dirent-shape-and-vfs-utimes.md` — relevant ratified decisions.
