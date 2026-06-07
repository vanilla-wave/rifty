# Terminal / shell — backlog

Status: living backlog. Last updated: 2026-06-07. Layer: `@riftydev/shell` (above runtime-*/kernel; imports `@riftydev/vfs` + `@riftydev/io` only — no reverse imports).

Tracks terminal/shell follow-ups that are **not yet done**. Done work lives in git + package CHANGELOGs + ADR-0081..0086; this doc is the forward-looking queue. Source-of-truth precedence: `PROJECT_PLAN.md` > ADRs > this file.

## What's already done (pointer, not duplicated here)

Coreutils/rich-terminal command surface — **complete & green** (26 builtins, all gates pass):
`pwd cd echo ls cat mkdir rm env touch head tail wc basename dirname realpath seq true false printf cp mv ls grep find which clear sleep` + glob expansion + shared `_walk`/`_sgr`/`_columns`/`_glob`. See ADR-0081..0086, `packages/shell/CHANGELOG.md`, OPEN_QUESTIONS Q-401/402/407..412.

## Milestone-label clarification (read first)

The real **M12 = opencode server facade** (PROJECT_PLAN.md §M12), NOT terminal IO. The shell-IO items below (pipes/redirect/stdin) are **shell-layer work (M10 "Real Tooling" tier)** that also serves as a **prerequisite for M12** — that's why `shell.ts` tags them `M12 work item` and the research doc lists them "(M12)". The label means "consumed by M12", not "is the M12 milestone". Keep that framing when scheduling.

---

## P1 — Shell-IO model (the next substantive chunk)

The dispatcher gap. Ordered by dependency; each gates the next. Live `NotImplementedError` sites confirm the gaps.

| # | Item | Current state | Notes |
|---|------|---------------|-------|
| 1 | **Pipes `\|`** | `NotImplementedError('shell.pipe')` in `shell.ts` runSegment | Wire stdout of segment N → `ctx.stdin` of N+1. Foundation: `CommandContext.stdin` (ADR-0082) already exists. Exit = last stage (POSIX), no `pipefail`. |
| 2 | **Input redirect `<`** | `NotImplementedError('shell.input-redirect')` | Open VFS file → `ctx.stdin` reader. Pairs with the existing trailing `>`/`>>` redirect logic. |
| 3 | **stdin mode for existing filters** | `NotImplementedError('shell.head.stdin')`; cat/wc/tail are file-arg-only | Once a command has no file args and `ctx.stdin` is connected, read from stdin. Needed: cat, wc, head, tail. |
| 4 | **Cancellation wiring** | shell + terminal both ready; gap is the wire | `TerminalPanel.tsx onSignal → Shell.run({ signal })`. `Shell.run` already resolves 130 on abort (ADR-0082); only the UI→shell hookup is missing. |
| 5 | **Background `&`** | `NotImplementedError('shell.background')` (no milestone tag) | Lower priority; decide if in-scope at all (browser has no real job control). Record decision before implementing. |

**Dependencies:** stdin-filter commands (P2) need #1 or #3 first. Cancellation (#4) is independent — can land anytime. Recommended order: 1 → 3 → 2 → (P2) → 4.

**Hard rules to keep:** no silent stubs (unimplemented modes throw `NotImplementedError('shell.<cmd>.<mode>')`); GNU exit codes load-bearing; stdin filter with no input connected must error cleanly, never stub (ADR-0082); parity is the gold standard.

## P2 — stdin-filter commands (need P1 pipes/stdin first)

None exist yet (`commands/{sort,uniq,cut,tr,tee}.ts` absent). Each is a `commands/<cmd>.ts` reading `ctx.stdin`, red-first TDD, registered in `builtins.ts`. Reusable pattern: the existing builtin fan-out workflow.

- [ ] `sort` — `-r -n -u -k -t -f`
- [ ] `uniq` — `-c -d -u -i`
- [ ] `cut` — `-d -f -c`
- [ ] `tr` — sets, `-d -s -c`
- [ ] `tee` — `-a`, writes stdin → stdout + file(s) via `syncMirror()`

## P3 — intentional flag gaps (deliberate, not bugs)

Per no-silent-stub these THROW `NotImplementedError` today and are tracked `❌` in compat-matrix. Implement on demand, not speculatively.

| Command | Unimplemented (throws) |
|---|---|
| basename / dirname / head | `-z` |
| seq | `-f FORMAT` |
| tail | `-f` / `-F` / `--retry` (no polling loop) |
| realpath | `-s`, `--relative-to`, `--relative-base` |
| which | `-a` / `--all`, `-s` |
| grep | `-E -P -A -B -C -w -x -o --include --exclude --color` |
| find | `-exec -print0 -mtime -size -newer -regex -prune -delete -empty -o -a -path`; `-type l/c/b/p/s` |
| ls | `-R -S -h -i -d --group-directories-first` |

**Usage-error fidelity nits (Q-2026-06-07-412, low-priority polish):** `find -name`/`-type` with a missing value, invalid `ls --color=WHEN` — currently loud but mis-shaped vs GNU (should be usage errors exit 2, not silent/`NotImplementedError`). Not blocking.

## P4 — test / fixture follow-ups

- **Frozen-GNU fixtures for grep/find** (Q-2026-06-07-411): deferred — `ggrep`/`gfind` not installed in this env. Hand-asserted conformance tests stand in (grep 22, find 12). Capture via `brew install grep findutils` (`LC_ALL=C`, version+locale header) or a Linux box, then mirror `ls-fixtures.test.ts`. `ls` is already byte-frozen vs gls 9.7.
- **ls `--color` / `-l` byte-fixtures** (Q-411): not fixtured by design — gls emits leading `ESC[0m` + zero-padded `01;34`; `-l` metadata is placeholder per ADR-0050 (VFS has no real perms/owner). Structural assertions only.

## Blocked (do not start)

- **git read-ops facade** (ADR-0085): `git status`/`diff`/`log` as structured facade results, write-ops throw. **Blocked on Q-2026-05-30-061** (isomorphic-git dependency ratification). Do NOT add isomorphic-git to any `package.json` until ratified. Doc-only.
- **M12 opencode server facade** (PROJECT_PLAN §M12): the consumer of the shell-IO + structured grep/glob/list tools. No-vendored-tree slice is green (ADR-0052..0055, F09); rest blocked on vendoring opencode → Spike C → WASM-SQLite. Separate large theme.

## Cross-references

- ADRs: 0081 (coreutils strategy), 0082 (CommandContext stdin/isTTY/SIGINT), 0083 (VFS copy/rename primitives), 0084 (Token[] + glob), 0085 (git facade — blocked), 0086 (parity-test strategy).
- OPEN_QUESTIONS: Q-401 (shared walker — implemented), Q-402 (SGR color — implemented), Q-407 (command-file layout), Q-408 (head/tail sign), Q-409 (realpath), Q-410 (tier-c parity), Q-411 (deferred fixtures), Q-412 (GNU usage-error fidelity).
- Research: `docs/research/rich-terminal-coreutils-2026-06-06.md` (design rationale, demand mapping, opencode tool-channel framing).
- Compat: `docs/compat/` (regenerate via `pnpm compat:generate` at milestone-DoD close).
