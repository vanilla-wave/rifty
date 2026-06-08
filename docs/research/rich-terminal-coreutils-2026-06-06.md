# Rich Terminal / Coreutils for rifty — Research

Status: research / pre-design. Today: 2026-06-06. Active milestones: M10 Real Tooling (partial), M12 opencode facade (partial).

## 1. Problem & motivation, scope

**Problem.** Two demand sources want a richer command surface than rifty's 9 flagless builtins:
- **Humans** in the playground terminal expect `ls -la`, `grep -rn`, `find`, `head`/`tail`/`wc`, columns, colors.
- **The opencode facade (M12)** — coding agents (opencode, Claude Code, Cursor, aider) run a **two-channel** model: structured file tools (read/grep/glob/list/edit/write) + **one bash tool** for execution (git, npm, node, build/test). Even with structured tools present, models *still* shell out to `rg`/`grep`/`ls`/`find` (opencode #14791, #6506); opencode's **bash-tool prompt** (`packages/opencode/src/tool/bash.txt`) routes grep usage to `rg` ("ALWAYS USE ripgrep at `rg`… pre-installed").

**Scope.** This doc covers the **command/coreutils surface** and its prerequisites (pipes, glob, redirect, `$?`, stdin, TTY, cancellation). It recommends an implementation strategy under rifty's hard rules. **Out of scope:** the opencode server facade design, git *implementation* (isomorphic-git, deferred Q-2026-05-30-061 — but its *agent-facing decision* is in scope, §8), full bash scripting (`for`/`if`/functions), network tooling.

**Key reframe (demand mapper):** rifty's shell is a *dispatcher with no real OS shell* — the inverse of opencode's "pass raw string to `/bin/sh`". For the agent channel this is a feature: the dominant channel is **structured tools**, each a few-dozen-line pure-JS function over the VFS — *no shell parsing, no pipe dependency*. The literal-bash fallbacks are lower priority and gated on pipes+glob+stdin (M12).

## 2. Current rifty state

**Shell (`@riftydev/shell`)** — pure-JS dispatcher; layer-position ABOVE runtime-*/kernel (may import them; they may not import it).
- `packages/shell/src/shell.ts` — tokenize, split on `&&`/`||`/`;` (POSIX short-circuit, final exit = last segment), `KEY=val cmd` env prefix (per-command snapshot), trailing `>`/`>>` redirect to VFS (EREDIRECT exit 1 on failure, loud), `onChunk` streaming (fires before blob append). Exit codes already meaningful: 127 command-not-found, 1 on throw, 1 on EREDIRECT. Throws `NotImplementedError`: `shell.pipe` (M12), `shell.input-redirect` (M12), `shell.background` (no M12 tag).
- `packages/shell/src/builtins.ts` — 9 builtins: `pwd cd echo ls cat mkdir rm env touch`. **Flag coverage minimal/none:** `ls` reads only `args[0]`, ignores all flags (no `-l/-a/-1/-R`, no columns, no color); `mkdir -p` only; `rm -r/-rf/-R/-f` only. All file ops via `syncMirror()`.
- `packages/shell/src/tokenize.ts` — single-quote literal, double/unquoted `$VAR`/`${VAR}` expansion (unknown→empty), no IFS word-splitting. **Output is `string[]` — discards quote provenance** (load-bearing for glob, see §6 #4). **Deliberately unsupported**: glob `* ? [abc]`, command substitution `$(…)`/backticks, heredocs, arithmetic. **Throws** on advanced param expansion `${VAR:-default}`/`${#VAR}`.
- `packages/shell/src/types.ts` — `CommandContext = {cwd, env, stdout, stderr}` — **no `stdin`, no `isTTY`, no cancellation signal**. `ShellCommand = (args, ctx) => Promise<number>`. **This is the public contract for both builtins AND `registerCommand` registrants** — any field added here is a cross-package public-API change.
- Higher commands injected via `Shell.registerCommand` at composition root (`apps/playground/src/App.tsx`, `glue/npm-shell-command.ts`), never baked in.

**Terminal (`@riftydev/terminal`)** — `terminal.ts` xterm.js wrapper, line-mode editing, echo, history, Ctrl+C (echo before `onSignal('SIGINT')`), ANSI passthrough (stderr red, prompt grey), ResizeObserver+FitAddon. **Gaps:** no `isatty`/cols/rows in `CommandContext`; no interactive stdin read; no AbortSignal/cancellation wired from `onSignal` into running commands (terminal *has* the SIGINT hook; the command can't observe it); no job control; no Ctrl+A/E/U/K line editing.

**VFS (`@riftydev/vfs`)** — `FsSync` via `syncMirror()`: `existsSync`, `readFileBytesSync`, `writeFileSync`, `readdirSync`→`VfsDirent{name,isFile,isDirectory}` (**FIELD form, not method form**), `statSync{isFile,isDirectory,size,mtime}`, `mkdirSync{recursive}`, `rmSync{recursive,force}`, `utimes`. Path utils `isAbsolute/joinPath/normalizePath/dirname/basename`. POSIX `VfsError` codes preserved. **No** `copyFileSync`, no copy-recursive, no atomic file `renameSync`, no symlink/chmod/glob. OPFS backend Worker-only; memory elsewhere.

**WASI (`@riftydev/runtime-wasi`) + kernel** — preview1 shim runs esbuild.wasm end-to-end (ADR-0047). Implemented: `args_get/environ_get`, `fd_read` (with `onStdin` callback + residual buffering — *pipe-ready*), `fd_write/readdir/seek/tell/filestat_get`, `path_open` (cwd as preopen fd3, ADR-0049), `path_create_directory/unlink_file/remove_directory/rename`, `clock_time_get`, `random_get`, `sched_yield`. **Honest `E_NOSYS`:** symlinks, `fd_pread/pwrite`, `sock_*`, **`poll_oneoff` (proc.ts → `E_NOSYS`, verified)**. Kernel `ProcessManager.spawnWorker()` = one Worker per process; long-running workers can be killed (Q-2026-06-05-317). **`child_process.spawn`→WASI `.wasm` dispatch is an M8 hook — seam present but unwired** (ADR-0038). NB: `path_rename` etc. are WASI *syscalls* inside the guest — **not** reachable from the JS shell layer; the shell only has `syncMirror()` methods.

**`vfs-grep`** — `packages/runtime-js/src/utils/vfs-grep.ts`: working pure-JS recursive grep, `vfsGrep(pattern, root, {include, maxResults, ignoreCase}) → VfsGrepMatch[]{path,line,column,text}`, literal-or-RegExp (`toRegExp` strips g/y flags to keep `.index`), suffix-match `include`. **PRIVATE** — NOT exported via `runtime-js/src/index.ts` (verified), no builtin (TODO(ADR) Q-2026-05-30-061). **Imports `readFileSync/readdirSync/Dirent` from runtime-js's `builtins/fs.ts` node:fs FACADE (method-form `Dirent.isDirectory()`), NOT `@riftydev/vfs` directly** — relocating it to shell means rewiring onto `syncMirror()` and adapting method→field Dirent shape.

**Hard prerequisites currently missing:** pipes `|` (M12), input redirect `<` (M12), glob `*` expansion (none — reaches builtin literally), command substitution `$(…)` (none), `$?` exit-status var (none), subshells (none), background `&` (deferred), stdin reader on context (none), TTY/cols-rows on context (none), cancellation/AbortSignal on context (none), ls columns/color (none).

## 3. StackBlitz WebContainers `jsh` as reference

`jsh` = StackBlitz's proprietary, closed-source custom shell, spawned via `webcontainerInstance.spawn('jsh', …)`. Cannot be vendored — design reference only; reimplement from POSIX/Node semantics, never copy. (Sometimes described as patent-pending; **unverified** — no source found, not load-bearing for "design reference only".)

- **Command set** (version-dependent; from live `ls /bin && ls /usr/bin`, issue #1165): `ls cat cp mv rm rmdir mkdir ln chmod touch echo pwd cd env which clear alias head tail sort true false kill ps hostname uptime curl` + StackBlitz-specific `open`. `bash/sh/zsh` are `@`-symlinks → `jsh` (not real bash). **Notably absent: `grep find sed awk wc sleep cut tr diff tar git`.** So a curated/minimal set is legitimate precedent — rifty deferring grep/find and keeping `vfs-grep` unwired *matches* jsh; a pure-JS `grep`/`find` would actually *exceed* jsh's published set.
- **JS-vs-WASM model:** WebContainers run **only JS + WASM** (no native binaries/addons unless WASM-compiled). `ls/cat/…` are JS/WASM reimplementations exposed by a "WASM-based OS"; Node itself runs as WASM. Each (pseudo)process = own Web Worker (community RE). **Confirms rifty's pure-JS-builtins direction is the browser-correct shape.**
- **Pipe/glob/redirect:** 2021 RE — "not even pipes work… for/if/variable refs unusable". Later StackBlitz added `.jshrc` aliases + persisted `.jsh_history` (June-2021); pipes reportedly added later (community RE, unconfirmed). `$(…)`, subshells, job control, full redirect/glob semantics **never officially confirmed** — cannot cite jsh as precedent for these. (rifty's existing `&&`/`||`/`;` + `>`/`>>` is arguably *ahead* of documented jsh.)
- **fs model:** in-browser VFS (memfs/BrowserFS-like) bridged through WASI preview1 so the WASM Node runtime and the commands share one tree with Unix permissions. **rifty's `syncMirror()` shared with node:fs is the same idea.**
- **Node integration:** `npm/npx/yarn/turbo/node` are ordinary PATH executables the shell *dispatches to* — **not builtins.** Exactly rifty's `registerCommand` split (turbo = their in-house pm; rifty's npm-client is the analog).
- **Terminal/TTY:** xterm.js; `process.output` (merged stdout+stderr `ReadableStream<string>`) → `terminal.write`; `terminal.onData` → input `getWriter()` (single locking writer); `resize(cols,rows)`. Genuine TTY-aware.

**What rifty borrows:** (1) pure-JS curated builtins over VFS — validated; (2) minimal-is-legitimate — don't feel obliged to vendor busybox; (3) incremental pipes path (jsh added them later — rifty's M12 mirrors this); (4) pm-as-injected-PATH-command; (5) merge stdout+stderr *only at the terminal sink* (keep fds separate internally for Node parity). **Caveat:** most internals are community RE, not StackBlitz-confirmed; command list drifts by version.

## 4. Option analysis

### A. Pure-JS builtins on VFS (jsh-style, zero-dep) — **recommended core**
- **Layer fit:** perfect. New builtins in `packages/shell/src/builtins.ts` over `syncMirror()` + path utils, exactly like the 9 existing. Internal helpers (glob→regex, SGR, ls-columns) are new `packages/shell/src/` files.
- **Reversibility:** **REVERSIBLE** per command *that uses only the existing context* (no public-API change, zero-dep). Anything needing a new `CommandContext` field (stdin/isTTY/cancellation) is **IRREVERSIBLE** — see §6/§8.
- **Effort:** each builtin ~15–150 zero-dep LOC. `head/tail/wc/cut/tr/sort/uniq/basename/dirname/realpath/seq/sleep/true/false/clear/printf` small. `cp/mv` need a VFS-primitive decision (no `copyFileSync`/atomic file-rename today — §8 Q-vfs-cpmv). `ls -la/-1/-R + columns + --color`, `cat -n/-A/-E` are upgrades. `grep` is **80% built** (promote `vfs-grep`). `find` = predicate engine over the readdirSync walker (~80–120 LOC).
- **Coverage:** the whole common set; **exceeds jsh** (which ships no grep/find). Misses: awk/sed (JS ecosystem = WASM-only), and stdin-filter modes (gated on pipes).
- **Maintenance:** all rifty source, no upstream. **Parity story: see §8 — NOT a free reuse of the existing node-parity-runner** (that harness runs JS modules over node:*, has no `ls`/`grep` oracle). Needs a new harness decision. Unimplemented flags → `NotImplementedError` + compat `❌`.
- **Color caveat:** emit **raw SGR** (`\x1b[1;34m…\x1b[0m`) to xterm directly. Do **NOT** use picocolors — its browser build returns plain (uncolored) strings, emitting no SGR (counter-indicated). A ~20–40-line LS_COLORS/SGR helper is strictly *more correct*. **Must gate on `isTTY`** (GNU `--color=auto`): emitting SGR into a redirect (`ls > f`) or pipe corrupts the file/stream — see §8 Q-color-tty.

### B. busybox / uutils WASM multicall via the WASI runner
- **Target = uutils/coreutils, NOT busybox.** busybox is **GPLv2-only (viral copyleft)** — disqualifying for a vendored binary in a permissive repo; and existing browser builds are Emscripten (not WASI), lack sh.
- **uutils:** **MIT**, builds to `wasm32-wasip1` as a single multicall binary (`--features feat_wasm`), **60–70+ WASI utilities** (uutils playground blog "60+"; release notes "70+" — *not* the ~100/102 full GNU set; that figure conflates the buildable WASI subset with the complete coreutils command list), `argv[1]` selects the applet (program-name-independent → rifty's generic `args_get` needs **zero shim changes**). Its playground architecture = 1:1 with rifty (JS shell + per-stage WASM instantiation; pipes orchestrated host-side). Bridges via the same WASI preopens esbuild already uses; `fd_read` `onStdin` already supports stage-chaining.
- **Layer fit:** clean — WASM guest in `runtime-wasi`, per-applet resolvers in `packages/shell` via `registerCommand`; dispatcher stays pure-JS.
- **Reversibility:** **IRREVERSIBLE** — vendoring a new binary → ADR required, adjacent to deferred ripgrep-WASM (Q-2026-05-30-061). rifty's own shim is a *superset* of needs and stricter (E_NOSYS, no silent stubs) → **no `@bjorn3/browser_wasi_shim` dependency needed.**
- **Effort:** vendor/build pipeline (Rust + wasm32-wasip1 toolchain) + one resolver. **Size: 3.27 MB compressed, plausibly ~8–12 MB uncompressed** (i18n embedded, single-threaded sort) — must be lazy-loaded, not in boot path. **Needs a real byte-budget (§8 Q-uutils-wasm): pin it against the already-vendored esbuild.wasm footprint as the reference ceiling; fetch only on first uutils-only applet; cache the compiled `WebAssembly.Module` (CacheStorage/IndexedDB) — re-fetch is unacceptable.**
- **Coverage:** ~60–70 real applets with genuine GNU-compatible flags (`ls -la`, `sort -n`, `cat -n`) that JS builtins can't cheaply match.
- **The one real shim gap: `poll_oneoff` → `E_NOSYS` (verified).** Batch utilities (ls/cat/sort/head/tail/wc/cp/mv/rm) don't poll → work. Interactive/polling applets (`more`, `tty`, some `timeout`) fail/hang → need minimal `poll_oneoff` OR an applet allowlist.
- **Maintenance:** upstream tracking, toolchain pinning, supply-chain (build-in-CI safer than prebuilt). Per-command `WebAssembly.instantiate` latency (cache the compiled `Module`, re-instantiate). **Parity:** uutils `ls`/`fd_readdir` would be the first heavy non-esbuild guest — parity-test vs Node/GNU before relying (same harness problem as §8). Cutover changes observable behavior (today `ls` has no flags → suddenly honors `-la/--color`) — coordinate, update tests *without weakening*.

### C. Hybrid — JS for hot/cheap, WASI for the long tail
- JS builtins for the constantly-hit cheap set (ls/cat/echo/head/tail/wc/grep/find/pwd/cd/mkdir/rm/cp/mv/touch) + uutils-WASM for the rare long tail (od/nl/fmt/fold/csplit/numfmt/dd/shuf/factor/tac/comm/paste/expr/stat/…).
- **Layer fit:** same as A+B. **Reversibility:** the WASM half is **IRREVERSIBLE** (same ADR as B); the JS half REVERSIBLE.
- **Effort:** highest (two code paths + a router) but each piece small. **Coverage:** broadest. **Maintenance:** two-path divergence risk (a command in both must not behave differently). **Parity:** two stories, both subject to the §8 harness decision.
- Best *long-term* shape but only justified once the JS core exists and a concrete long-tail need appears.

### D. One small glob/match dependency (picomatch)
- For **full bash glob** (`**`, brace ranges `{01..09}`, extglob). picomatch v4 = **MIT, ZERO runtime deps**, compiles glob→RegExp, browser-safe platform detection (checks `navigator.platform`).
- **Reversibility:** **IRREVERSIBLE** — new external dep → ADR. Can bundle ~5K larger than minimalist alternatives.
- **Not needed for the default.** A hand-rolled single-segment matcher (`* ? [...]`, ~30–50 LOC) covers `ls *.ts`, `rm foo/*.log`, grep `--include`. Reserve picomatch as a *deliberate ADR-gated upgrade* if recursive `**` becomes a verified need; don't half-support globs ambiguously.

**fast-glob (18 deps ~503KiB) / globby (23 deps ~605KiB)** = Node-FS traversal, wrong layer. **shelljs** = Node `child_process`, not browser-safe. **bash-emulator / javascript-terminal** = design references only (latter pulls Immutable.js + archived). **awk/sed** = emscripten-WASM-only (IRREVERSIBLE binary) — defer; a pure-JS `sed s///` subset (~80–120 LOC) is feasible if wanted.

## 5. Gap matrix

Status legend: ✅ done · ⚠️ partial · ❌ missing. Approach: **JS** = pure-JS builtin over VFS · **JS+grep** = promote vfs-grep · **WASI** = uutils long tail (opt C) · **tool** = structured facade endpoint, not a shell builtin · **prereq** = needs pipes/glob/stdin first.

| Command | Current | Agent demand | Recommended approach |
|---|---|---|---|
| `pwd` | ✅ builtin | T4 | keep JS |
| `cd` | ✅ builtin | T4 | keep JS |
| `echo` | ✅ (no `-n/-e`) | T3 (redirect) | JS: add `-n/-e` |
| `ls` | ⚠️ no flags | T2 | **JS upgrade**: `-l/-a/-1/-R`, columns, `--color` (SGR, **TTY-gated**) |
| `cat` | ✅ (no flags) | T2 | JS: add `-n/-A/-E` |
| `mkdir` | ✅ `-p` | T4 | keep JS |
| `rm` | ✅ `-r/-f` | T4 | keep JS |
| `env` | ✅ builtin | T4 | keep JS |
| `touch` | ✅ builtin | T4 | keep JS |
| `cp` | ❌ | T4 | **JS** + **VFS-primitive decision** (no `copyFileSync` today; `-r` = hand-rolled walk, partial-failure semantics — §8 Q-vfs-cpmv) |
| `mv` | ❌ | T4 | **JS** — **no atomic file `renameSync` in syncMirror today**; naive read+write+rm loses mtime/atomicity (§8 Q-vfs-cpmv). NB `path_rename` is a WASI guest syscall, not shell-reachable |
| `ln`/`ln -s` | ❌ | rare | ❌ `NotImplementedError` (VFS no symlinks, ADR-0050) |
| `chmod` | ❌ | rare | ❌ `NotImplementedError` (VFS no perms) |
| `grep`/`rg` | ⚠️ vfs-grep private | T2 (high) | **JS+grep**: promote, add `-r/-n/-i/-v/-c/-l/-E` + match SGR (TTY-gated); **tri-state exit 0/1/2** (§8); also facade `grep` **tool** w/ `--count` (pre-empts `rg\|wc`) |
| `find` | ❌ | T2 | **JS** predicate engine: `-name`(glob) `-type` `-maxdepth` `-path` `-empty` `-print`; `-exec` → `NotImplementedError` |
| `head` | ❌ | T2 (file-arg) | **JS** `-n/-c` |
| `tail` | ❌ | T2 (file-arg) | **JS** `-n`; `-f` → `NotImplementedError` (streaming) |
| `wc` | ❌ | T3 | **JS** `-l/-w/-c/-m` (file-arg now; stdin via prereq) |
| `sort` | ❌ | T3 | **JS** `-r/-n/-u/-f` (prereq for pipe input) |
| `uniq` | ❌ | T3 | **JS** `-c/-d/-u` (prereq) |
| `cut` | ❌ | T3 | **JS** `-d/-f/-c` (prereq) |
| `tr` | ❌ | T3 | **JS** sets, `-d` (prereq) |
| `sed` | ❌ | T3 | **JS** `s///` subset OR defer; full = WASI/awk-class |
| `awk` | ❌ | T3 | **defer** (emscripten-WASM-only; or WASI opt C) |
| `diff`/`xargs`/`tee` | ❌ | T3 | `tee` JS (prereq); `xargs`/`diff` later |
| `basename`/`dirname`/`realpath` | ❌ | T4 | **JS** (path utils) |
| `seq`/`true`/`false`/`clear` | ❌ | T4 | **JS** (`clear` = emit `\x1b[2J\x1b[H`) |
| `sleep` | ❌ | T4 | **JS** (`await setTimeout`); long-sleep needs cancellation (§8 Q-cancel) |
| `which`/`printf` | ❌ | T4 | **JS** subset |
| long tail (od/nl/fmt/stat/dd/shuf/…) | ❌ | rare | **WASI** (opt C) if/when needed |
| `git`/`gh` | ❌ | **T1** | **agent-facing decision NOW (§8 Q-git), implementation deferred** — isomorphic-git IRREVERSIBLE Q-2026-05-30-061 |
| `npm`/`pnpm`/`node`/`vite`/`tsc` | ⚠️ npm wired | **T1** | injected via `registerCommand`; **long-running dev servers need a non-terminating-process contract (§6 #6, §8 Q-cancel)** |
| **structured tools** read/glob/list/edit/write | ❌ | high (M12) | **tool** (pure-JS over VFS; reuse vfs-grep, readdirSync, statSync mtime) |

T1=must-have execution (injected, not builtins). T2=frequent bash fallbacks, **better served by structured tools**. T3=text-glue, **useless without pipes**. T4=trivial.

## 6. Prerequisite features — ownership & ordering

The T3 glue palette (wc/sort/uniq/cut/tr/sed/tee) is **worthless without `|`+stdin**. Building them before pipes = wasted effort. Sequence:

1. **`stdin` reader on `CommandContext`** — the missing primitive (verified: `types.ts` has only cwd/env/stdout/stderr). **IRREVERSIBLE** — `CommandContext` is `@riftydev/shell`'s public contract consumed by playground/test registrants across the package boundary (checklist item 1). Needs an **inline ADR**, not just OPEN_QUESTIONS. Must pin: sync vs async reader, EOF signaling, optional-for-back-compat (existing registrants must keep compiling). `fd_read`'s `onStdin` already exists at the WASI syscall level. Unblocks `<` and pipe RHS.
2. **Pipes `|`** — **M12 already owns this** (`NotImplementedError('shell.pipe')`). Host-side orchestration: stage N stdout → stage N+1 stdin (jsh/uutils model). Independent of JS-vs-WASM builtin choice.
3. **Input redirect `<`** — M12, trivial once (1) lands (read file → stdin).
4. **Single-segment glob expansion** — `*.ts` must expand *before* argv reaches the builtin (coreutils don't glob — shell does). **NOT a pure dispatcher-only 30–50 LOC addition:** correct globbing needs the tokenizer to **preserve per-token quoted-provenance** (`grep '*.ts'` must stay literal, `grep *.ts` must expand) — `tokenize.ts` output is `string[]` today and drops that, so its output contract changes to a richer token type. Also decide **no-match policy** (lean: bash nullglob-off → pass literal pattern through; zsh errors — pick bash). Expanded against the tree via the readdirSync walker (proven in vfs-grep). Full `**`/braces = picomatch ADR (opt D), later.
5. **`$?` exit-status var** — small tokenizer/dispatcher addition (last exit tracked). REVERSIBLE. **Demand understated:** the shell *already* supports `&&`/`||` short-circuit, so exit codes are load-bearing TODAY (agents branch on `cmd && next` / `cmd || fallback`). Each new builtin must define its GNU-faithful exit code (see §8 exit-code subsection).
6. **Non-terminating foreground processes (vite/node http) — the real "Express + vite in browser" blocker, bigger than `&`.** `Shell.run` awaits the handler's returned number; a dev server never returns → blocks forever. The terminal already has `onSignal('SIGINT')` (terminal.ts), but `CommandContext` exposes **no AbortSignal/cancellation** for the running command to observe. Decide a **streaming-until-Ctrl-C contract**: `Shell.run` resolves on SIGINT, command observes cancellation via a new context field. This is a `CommandContext` addition → **IRREVERSIBLE** (same boundary as stdin). Ties to Q-2026-06-05-317 (kernel kills long-running workers). See §8 Q-cancel.
7. **Background `&`** — deferred (no M12 tag). Distinct from #6: even with a cancellation contract, true backgrounding needs a job model. Out of scope here; relates to Q-2026-06-05-317.
8. **Command substitution `$(…)`, subshells** — not planned; no jsh precedent. Defer indefinitely.
9. **`isTTY` + cols/rows on context** — needed for (a) `ls` column width (fall back to 80) and (b) **HARD correctness: color gating** — `--color=auto` must suppress SGR when stdout is a redirect/pipe, else `ls > f` / `ls | grep` writes escape codes into files/streams (corrupts the existing redirect feature). The redirect path and future pipe RHS must set a non-TTY context. Another `CommandContext` field → **IRREVERSIBLE**. See §8 Q-color-tty.

**Note:** #1, #6, #9 all add `CommandContext` fields — bundle them into **one ADR** for the context-shape change (optional fields, back-compat) rather than three separate boundary churns.

## 7. Recommendation & phased plan

**Adopt Option A (pure-JS builtins) as the core; reserve B/C/D as ADR-gated upgrades for a verified need.** This stays zero-dep, REVERSIBLE per command (for commands needing no new context field), layer-clean. jsh validates this exact shape. **Caveat:** the "parity story" is *not* a free reuse of the existing harness — resolve §8 Q-parity-harness before leaning on it as a selling point.

- **Phase 0 (M10/M11, now, no prereqs):** ship the **structured-tool facade endpoints** (read w/ offset+line-numbers, grep, glob mtime-sorted, list/read-dir, edit exact-replace, write) as pure-JS over VFS — highest-leverage agent work, needs no pipes. Promote `vfs-grep` (decide single home — §8 Q-grep-home; rewire onto `syncMirror()` field-form Dirent). Build the file-arg-mode JS builtins useful standalone: **ls upgrade (flags+columns+SGR color, TTY-gated), cat -n, head, tail -n, wc, find, basename/dirname/realpath, seq, sleep, true/false, clear, which, grep**. Add SGR + glob-segment + ls-column internal helpers. **Settle the context-shape ADR (stdin/isTTY/cancellation, §6 note) and the VFS cp/mv-primitive decision (§8 Q-vfs-cpmv) before commands that depend on them.** Each lands with a parity case *per the harness chosen in §8*.
- **Phase 1 (M12, prereq chain):** add the `CommandContext` fields (one ADR) → implement `|` pipes → `<` redirect → glob expansion (with tokenizer quote-provenance change, §6 #4). Then the T3 filters (sort/uniq/cut/tr/tee, wc/grep/head stdin modes) become live. Wire the opencode bash channel: agent command string → `Shell.run()` → registered T1 commands + the now-useful fallbacks. Land the cancellation contract so `vite`/`node http` work as long-running foreground processes.
- **Phase 2 (post-M12, on verified need only):** ADR-gate Option C (uutils-WASM long tail, with byte-budget §8 Q-uutils-wasm) and/or D (picomatch for `**`). Decide alongside deferred ripgrep-WASM (Q-2026-05-30-061). Implement minimal `poll_oneoff` only if interactive applets are needed.

T1 commands (git/npm/node/vite/tsc) stay `registerCommand` injections throughout — never baked into the shell.

## 8. Open decisions

| ID (proposed) | Decision | Reversibility | Options | Lean |
|---|---|---|---|---|
| Q-ctx-shape | add stdin + isTTY + cancellation to `CommandContext` | **IRREVERSIBLE** (public cross-package contract, checklist item 1) | (a) one ADR adding all three as optional back-compat fields; (b) three separate boundary changes | **(a)** — single context-shape ADR; optional fields keep existing registrants compiling |
| Q-stdin-ctx | stdin reader shape | IRREVERSIBLE (part of Q-ctx-shape) | sync vs async; EOF signaling; optional | **async reader, explicit EOF, optional** — gates `<` + pipe RHS |
| Q-cancel | how a running command observes Ctrl-C / runs non-terminating (vite/node http) | **IRREVERSIBLE** (context field) | (a) AbortSignal field, `Shell.run` resolves on SIGINT; (b) job model now | **(a)** — minimal streaming-until-Ctrl-C; defer job model. Real blocker for "vite in browser", ties to Q-2026-06-05-317 |
| Q-color-tty | SGR color gating | **IRREVERSIBLE** (isTTY context field) | always-emit vs `--color=auto` gated on isTTY | **gate on isTTY** — HARD correctness: redirect/pipe must suppress SGR or it corrupts files/streams |
| Q-parity-harness | how shell builtins get parity tests | recordable (test infra) | (a) new shell-parity harness, oracle = host `spawn('ls',…)` — **non-deterministic** (macOS BSD vs Linux GNU, locale sort, the §9 divergences); (b) frozen GNU golden-fixture snapshot (no live oracle, loses "parity" guarantee); (c) node:fs-expressible filters reuse node-parity-runner | **(c) where possible + (b) frozen GNU fixtures otherwise**, per command class; record which. Existing node-parity-runner runs JS-over-node:* modules — **has no `ls`/`grep`/`find` oracle**, so the "excellent parity" claim is unsubstantiated until this lands |
| Q-vfs-cpmv | cp/mv VFS primitives | **IRREVERSIBLE** if it adds VFS public API | (a) `copyFileSync`/atomic `renameSync` in `@riftydev/vfs`; (b) shell-side read+write+rm (non-atomic, mtime-loss) | **(a) add VFS primitives** (ADR) — specify same-vs-cross-dir mv, mtime preservation, recursive-cp partial-failure |
| Q-grep-home | single home for the grep/walker logic (builtin + facade tool share it) | REVERSIBLE (internal) unless re-export touches public API | (a) re-export `vfsGrep` from `runtime-js/src/index.ts`; (b) relocate pure walker into vfs/shell, rewired onto `syncMirror()` (field-form Dirent) | **(b)** — one shared util; avoids two-path divergence. NB: current walker imports method-form Dirent from runtime-js `builtins/fs.ts` → real shape adaptation, not trivial |
| Q-color-impl | how `--color` emits | REVERSIBLE | hand-rolled SGR vs picocolors | **hand-rolled SGR** — picocolors browser build returns uncolored strings (wrong) |
| Q-glob-scope | glob expansion depth + tokenizer change | (a) touches tokenizer output contract (recordable, near-IRREVERSIBLE if public); (b) IRREVERSIBLE (dep) | (a) single-segment `* ? [..]` hand-rolled **+ tokenizer quote-provenance + no-match=pass-literal**; (b) picomatch for `**`/braces | **(a) now** (incl. tokenizer token-type change), (b) ADR-gated on verified `**` need |
| Q-uutils-wasm | vendor uutils coreutils.wasm | **IRREVERSIBLE** (binary, ADR) | (a) never (JS only); (b) long-tail only (opt C); (c) full cutover | **(b) only on verified need**; decide with Q-2026-05-30-061. **Needs explicit byte-budget** (ref: esbuild.wasm footprint), lazy-fetch on first applet, compiled-Module cache |
| Q-busybox | busybox.wasm | IRREVERSIBLE + **GPLv2** | reject | **reject** — copyleft + Emscripten-not-WASI |
| Q-awk-sed | awk/sed | sed-subset REVERSIBLE; WASM IRREVERSIBLE | defer / sed `s///` subset / WASI | **defer**, set expectation early (`NotImplementedError`) |
| Q-git | agent-facing `git` in M12 bash channel (impl deferred ≠ decision deferred) | **IRREVERSIBLE** (whatever the answer, it's the highest-demand T1 command) | (a) `NotImplementedError` + compat ❌ (honest; breaks most agent flows); (b) structured git-status/diff **tool** via isomorphic-git read-ops (Q-2026-05-30-061 opt C); (c) stub commit/push to fake remote | **(b) read-ops tool** — `git status`/`diff`/`log` are the agent's most-emitted; 127 on every turn collapses the bash-channel value. Implementation deferred, but decide the contract now |
| Q-background | `&` / job model | IRREVERSIBLE (kernel server-process) | own ADR | **defer** — ties to Q-2026-06-05-317; distinct from Q-cancel (#6) |
| Q-merged-vs-tool | agent grep via tool vs bash | n/a (facade) | structured-tool-first + minimal bash fallback | **structured-first**; keep a `list` tool (opencode #6506) to curb shell exploration |

**Exit-code & stderr semantics (load-bearing TODAY — `&&`/`||` already ship).** Each new builtin must define its GNU-faithful exit code, because the existing short-circuit operators branch on it:
- `grep`: **0 = match, 1 = no-match, 2 = error** (tri-state; agents rely on it).
- `find`: 0 ok / >0 on error; `head`/`tail`/`wc`/`sort`: 0 ok / 1–2 on file/usage error.
- `true`/`false`: 0 / 1.
- **stderr contract:** usage/errors → fd2 (not fd1); keep fd1/fd2 **separate internally**, merge only at the xterm sink (Q-color-model below) so `2>&1`-style and `$?` behavior stays Node-faithful.

| ID (proposed) | Decision | Reversibility | Options | Lean |
|---|---|---|---|---|
| Q-color-model | stdout/stderr at terminal | small | merge at terminal sink (jsh) vs strict POSIX 1/2 | **keep fds separate internally, merge only at xterm sink** — preserves Node parity + `$?`/`2>&1` faithfulness |

**Parity-test strategy.** Per project policy every implemented builtin/flag must land with a parity case — **but the existing `node-parity-runner` cannot serve as that oracle for shell commands** (it runs JS modules over `node:*`; Node has no `ls`/`grep`/`find` module). Resolve **Q-parity-harness** first: (c) reuse node-parity-runner only for filters expressible as `node:fs` scripts; otherwise (b) frozen GNU golden-fixture snapshots (host `spawn` is non-deterministic across dev machines — macOS BSD vs Linux GNU, locale sort — so it can't be the live gold oracle). Every *unimplemented* flag throws `NotImplementedError` + compat-matrix `❌` (no silent stub — a flagless `ls` silently honoring `-R` is worse than throwing). For the WASI path: parity uutils `ls`/`find` vs the chosen oracle before relying. Document GNU-divergences (locale sort order, `-A` vs `-a`, `wc -m` vs `-c`) in the compat matrix.

## 9. Risks & non-goals

**Risks.**
- **Models shell out anyway** (opencode #14791/#6506) — structured tools alone insufficient; need a minimal real bash fallback → drags in the M12 pipe/glob/stdin work. Mitigate: keep a `list` tool + tune facade prompt to discourage shell exploration.
- **"Half a tool" mid-M11** — file-arg filters without pipes feel broken (`cmd | grep` unavailable). Build them forward-compatibly but set expectations; a JS `grep --count` pre-empts the `rg|wc` pipe demand.
- **`ls -R`/`ls *.ts`/`find` without recursion/glob silently return wrong/empty** — worse than throwing. Route to JS glob/list or `NotImplementedError`, never half-implement.
- **Glob correctness needs a tokenizer change** — quote-provenance must survive tokenization (`grep '*.ts'` literal vs `grep *.ts` expand); the current `string[]` output can't distinguish them. Not a dispatcher-only change.
- **SGR color into non-TTY sinks** — without `isTTY` gating, `ls > f` / `ls | grep` writes escape codes into files/streams, corrupting the existing redirect feature. Color is a HARD correctness item, not cosmetic.
- **Exit codes are load-bearing now** — `&&`/`||` already ship, agents branch on grep's tri-state (0/1/2) etc.; each builtin needs a GNU-faithful exit code + parity case or rifty silently diverges on `cmd && next`.
- **Non-terminating servers block `Shell.run`** — `vite`/`node http` never return an exit code; without a cancellation contract the dispatcher hangs. This (not `&`) is the actual "Express + vite in browser" blocker.
- **cp/mv lack a VFS primitive** — naive read+write+rm is non-atomic and drops mtime; `path_rename` is a guest WASI syscall, *not* shell-reachable. Needs a VFS public-API decision (Q-vfs-cpmv).
- **Bashisms** (`[[ ]]`, arrays, `$(…)`, heredocs, `set -o pipefail`) — rifty's JS dispatcher supports none; agent emitting them mis-tokenizes. Constrain agent bash to the rifty subset via system prompt.
- **Parity-harness gap** — there is no existing oracle for shell-command parity; the "excellent parity story" is unsubstantiated until Q-parity-harness lands. GNU subtleties (locale, byte-vs-char, `-prune`) compound it.
- **Color/width correctness** — hand-rolled LS_COLORS won't match `$LS_COLORS`; naive columns ignore wide/zero-width unicode (no wcwidth). Scope as known ASCII-only limitation.
- **WASI path** (if taken): 3 MB+ download (lazy-load, never boot path; needs a real byte-budget vs esbuild.wasm), per-command instantiation latency (cache compiled Module), `poll_oneoff=E_NOSYS` breaks interactive applets, behavioral cutover breaks current ls tests, supply-chain of a vendored blob.
- **Lib-grab temptation** — picocolors/columnify/glob each IRREVERSIBLE; for color the popular lib is *actively wrong* (browser strip). Easy to get backwards.
- **git is T1 and absent** — the agent's single most-emitted execution command; isomorphic-git deferred (Q-2026-05-30-061). Decide the *agent-facing contract* now (Q-git) even though implementation is deferred, else `git status`/`git diff` return 127 every turn and the bash channel's value collapses.

**Non-goals.** Full bash scripting (for/if/functions/subshells), command substitution, `&` background/job control (separate kernel decision, distinct from the Q-cancel cancellation contract), awk/full-sed, real symlinks/chmod (VFS doesn't model them), wcwidth/CJK column alignment, vendoring busybox (GPL), the opencode server facade itself, the git *implementation* (only its agent-facing contract is in scope, Q-git).