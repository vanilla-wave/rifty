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

- [ ] **Run the opt-in live express install** (`tests/integration/express-live.opt-in.test.ts`).
  - Invocation: `RIFTY_LIVE_REGISTRY=https://registry.npmjs.org pnpm vitest run express-live.opt-in`.
  - Outcome A — succeeds: M9 closure stays on its current path; M11 nested install remains a follow-on.
  - Outcome B — `EVERSIONCONFLICT`: capture the offending pair from `err.packageName` / `firstVersion` / `secondVersion`. M11 **nested install becomes a prerequisite for M9 closure**, not a follow-on. Express, Vite, and OpenCode all gate on it.
  - Refs: `docs/follow-ups-2026-05-27.md` item #1, ADR-0023, ADR-0028.

## Express

Smallest target. M7 (net + http + SW preview) already delivers
`http.createServer().listen(3000)` end-to-end through the playground.

### Hard blockers

- [ ] **#1 outcome** (above) — until it runs, this is the unknown.
- [ ] **M11 nested install** — only if #1 fails. Tracked in M9 open acceptance ("Nested install for version conflicts").

### Soft blockers (UX, not function)

- [ ] **Follow-ups #15 — `useNpmCommand(shell, npmClient)` adapter.**
  - Without it, `npm install express` at the playground prompt returns exit 127. Install runs only through the `npmClient.install(...)` API.
  - Wiring lives in `apps/playground/src/glue/` (post-#7 rename). Touch the playground composition root to register `npm` and `node` shell commands.
  - Includes progress reporting via `shell.run`'s `onChunk` callback so `npm install` shows a real bar at the terminal instead of dumping the final blob.

### Not blocking

- #9, #11, #14, #16, #17, #20, #23 — internal ergonomics, zero express impact.

## Vite

Express requirements + dev-server transformation + cross-realm HMR.

### Hard blockers

- [ ] **#1 outcome** + possibly nested install — Vite's transitive graph is bigger than Express's, so the EVERSIONCONFLICT probability is higher.
- [ ] **M8 — vendor `esbuild.wasm` end-to-end through the WASI runner.** Currently the M10 dev-server has no TS/JSX transformation path. M8 open acceptance.
  - [ ] **Follow-ups #24 — WASI preopens `cwd` + ordering semantics.** Currently `OPEN_QUESTIONS Q-2026-05-27-003`. esbuild expects a working directory; the right API shape (option A: `cwd?: string`; option B: ordered array; option C: both) gets decided when esbuild is the concrete consumer.
- [ ] **Cross-realm HMR / Vite-in-Worker** — M10 open acceptance ("Vite-in-Worker per ADR-0011") + ADR-0025 dev-server-realm split.
  - [ ] **Follow-ups #6 — `PreviewOwnerBinding` interface** (currently `OPEN_QUESTIONS Q-2026-05-27-002`). Pairs the SW `OwnerResolver` swap with the readiness registry; both halves move together when `WorkerOwnerResolver` lands.
  - [ ] **Follow-ups #8 — extract `realVite.ts` phase helpers.** Pure refactor for the worker-realm fork; lands alongside the realm swap.

### Soft blockers

- [ ] **Follow-ups #15** — same UX gap as Express; `npm install vite` at the prompt.
- [ ] **Shadow-registry consolidation** (M10 open acceptance, ADR-0015) — move `overrides.ts` + shim files under `tools/shadow-registry/`. Needed at scale once Vite drags in packages we have to shim.

### Not blocking

- #9, #11, #14, #16, #17, #20, #23 — same as Express.

## OpenCode

Hardest target. Express + Vite requirements + CLI shape + real-TCP-shaped
streaming + likely native-dep shims.

### Hard blockers

- [ ] **All Express + Vite hard blockers.**
- [ ] **M11 nested install** — almost certainly triggers regardless of #1 outcome, because OpenCode's transitive graph is larger than Vite's.
- [ ] **`node script.ts` from shell prompt.**
  - [ ] **Follow-ups #15** — `useNpmCommand` registers `node` alongside `npm`.
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

1. **Today** — run the opt-in express install (#1) to settle the M11-nested-install timing. One operator action.
2. **Next session** — land **#15** (`useNpmCommand`) as a focused PR. Closes the prompt-install UX gap for all three targets at once and is the only soft-blocker that touches the operator-facing experience.
3. **If #1 returned EVERSIONCONFLICT** — promote M9-open-acceptance "Nested install" to a blocker; this is the biggest open work item before any of the three targets land.
4. **M8 esbuild.wasm + #24** — required for any vite-class target. Unblocks both Vite and OpenCode.
5. **M11 cross-realm work (#6, #8, ADR-0025 follow-up, WebSocket bridge)** — required for Vite-in-Worker and OpenCode-class streaming.
6. **Native-dep policy + shadow-registry consolidation** — surfaces during real install attempts; concrete shim list grows from there.

## References

- `docs/follow-ups-2026-05-27.md` — 24-item triage with per-item Decision lines.
- `OPEN_QUESTIONS.md` — Q-2026-05-27-002 (preview owner binding), Q-2026-05-27-003 (WASI cwd).
- `TASKS.md` — milestone open-acceptance gaps referenced inline above.
- `PROJECT_PLAN.md` — D-001..D-007 decisions log.
- `docs/adr/0011-spawn-worker-as-process.md`, `0023-lockfile-reuse.md`, `0025-toolchain-dev-server-realm.md`, `0028-prod-proxy-for-npm-registry.md`, `0041-readdir-dirent-shape-and-vfs-utimes.md` — relevant ratified decisions.
