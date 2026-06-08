# ADR 0081: Coreutils command-surface strategy — pure-JS builtins over the VFS, busybox rejected, uutils/picomatch ADR-gated

Status: Accepted (2026-06-06)
Date: 2026-06-06

## Context

Two demand sources want more than rifty's 9 flagless builtins (`pwd cd echo ls cat mkdir rm env touch`, `packages/shell/src/builtins.ts`): humans in the playground terminal (`ls -la`, `grep -rn`, `find`, `head/tail/wc`, columns, color), and the M12 opencode bash channel (agents still shell out to `rg`/`grep`/`ls`/`find` even with structured tools present — opencode #14791/#6506; its bash prompt routes grep to `rg`). Full research: `docs/research/rich-terminal-coreutils-2026-06-06.md` (§4 options, §7 recommendation, §9 risks/non-goals).

The fork: how do we grow the command surface? Pure-JS builtins, a vendored WASM coreutils multicall, a hybrid, or pulling in a glob dependency. This choice sets rifty's **dependency/vendoring posture** for the whole command surface — hence IRREVERSIBLE (checklist items 1, 2, 4). Per-command additions that use only the existing context are separately REVERSIBLE.

Grounding facts (verified): shell layer is a pure-JS dispatcher above runtime-*/kernel; all 9 builtins go through `syncMirror()`; higher commands inject via `registerCommand` at the composition root (never baked in); `vfs-grep` is a working private pure-JS recursive grep, unwired (Q-2026-05-30-061). jsh (StackBlitz, design reference only — closed-source, never copied) is pure-JS/WASM over an in-browser VFS and ships **no** grep/find/sed/awk — minimal/curated is legitimate precedent.

This ADR fixes only the **strategy/posture**. Mechanism prerequisites are sibling ADRs: 0082 (CommandContext stdin/isTTY/cancellation), 0083 (VFS copyFileSync+renameSync for cp/mv), 0084 (tokenizer rich-token-type + single-segment glob), 0086 (shell-command parity harness). 0085 records the agent-facing git contract.

## Decision

**Adopt Option A — pure-JS builtins over the VFS sync mirror — as the core coreutils strategy** for the playground terminal and the opencode bash channel.

- New builtins live in `packages/shell`, zero-dep, over `syncMirror()` + path utils, exactly like the existing 9. Internal helpers (glob→regex, SGR/color, ls columns) are new `packages/shell/src/` files. The dispatcher stays pure-JS; T1 tooling (git/npm/node/vite/tsc) stays `registerCommand`-injected, never baked in.
- **Reject busybox.wasm** — GPLv2 viral copyleft (disqualifying for a vendored binary in a permissively-licensed repo), and shipped browser builds are Emscripten, not WASI (no `sh`).
- **Defer Option B (uutils/coreutils MIT WASM multicall via the WASI runner)** and **Option D (picomatch glob dependency)** behind a *verified need* and their own future ADRs, decided alongside the already-deferred ripgrep-WASM/isomorphic-git (Q-2026-05-30-061). Both are IRREVERSIBLE (new dep / vendored binary) and not justified by the current need.
- **Each new pure-JS builtin that uses only the existing CommandContext is REVERSIBLE** (no public-API change, zero-dep) — no ADR per builtin. This umbrella ADR is the IRREVERSIBLE part: it sets the posture (reject busybox; gate uutils/picomatch). A builtin that needs a *new* CommandContext field is gated by ADR-0089, not by this one.

## Alternatives considered

- **A — pure-JS builtins on VFS (chosen).** Layer-perfect; zero-dep; REVERSIBLE per context-free command; matches jsh's browser-correct shape and *exceeds* its published set (jsh ships no grep/find). `grep` ~80% built (promote `vfs-grep`); `find` ~80–120 LOC over the readdirSync walker; head/tail/wc/cut/tr/sort/uniq/basename/dirname/realpath/seq/sleep/true/false/clear/printf small. Cons: no awk/sed (JS ecosystem = WASM-only); GNU-flag fidelity is hand-rolled; cp/mv need a VFS primitive (ADR-0090); color must be raw SGR (not picocolors — its browser build returns uncolored strings) gated on isTTY (ADR-0089); parity needs a new harness (ADR-0093), not free reuse of node-parity-runner.
- **B — uutils/coreutils MIT WASM multicall via the WASI runner (deferred).** MIT (clean, unlike busybox); builds to `wasm32-wasip1` as one program-name-independent multicall (`argv[1]` applet selector → zero shim changes); ~60–70 genuine GNU-flag applets; bridges via the same WASI preopens esbuild uses; rifty's own shim is a stricter superset (no `@bjorn3/browser_wasi_shim` dep needed). Cons: vendors a binary → **IRREVERSIBLE**, ADR-gated; ~3.27 MB compressed (uncompressed size unverified, estimated multi-MB) → must be lazy-loaded with a real byte-budget vs esbuild.wasm + compiled-Module cache; `poll_oneoff → E_NOSYS` (verified) breaks interactive applets; behavioral cutover (flagless `ls` → suddenly honors `-la/--color`) breaks current tests; toolchain/supply-chain burden. Justified only once the JS core exists and a concrete long-tail need appears — decide with Q-2026-05-30-061.
- **C — hybrid (JS hot/cheap + uutils-WASM long tail) (deferred).** Broadest coverage; best *long-term* shape. The WASM half is IRREVERSIBLE (same ADR as B), the JS half is A. Cons: highest effort (two paths + router), two-path divergence risk, two parity stories. Premature now — it's A-then-maybe-B, so adopting A *is* the on-ramp to C.
- **D — picomatch glob dependency (deferred).** MIT, zero runtime deps, compiles glob→RegExp, browser-safe — for full bash glob (`**`, brace ranges, extglob). New external dep → **IRREVERSIBLE**, ADR-gated. Not needed for the default: a hand-rolled single-segment matcher (`* ? [...]`, ~30–50 LOC) covers `ls *.ts`, `rm foo/*.log`, grep `--include` (ADR-0091). Reserve picomatch as a deliberate upgrade if recursive `**` becomes a verified need. (fast-glob/globby = wrong layer, Node-FS traversal, many deps; shelljs = uses child_process, not browser-safe — all rejected.)
- **busybox.wasm — REJECTED outright.** GPLv2-only viral copyleft contaminates a permissively-licensed repo when vendored as a binary; available browser builds are Emscripten, not WASI, and lack `sh`. Not deferred — rejected. uutils (MIT) is the only WASM-coreutils path that stays open.

## Consequences

- New builtins land in `packages/shell`, **zero-dep**, over `syncMirror()` — `package.json` for `@riftydev/shell` gains no runtime dependency from this work.
- **No silent stubs:** every unimplemented flag/applet throws `NotImplementedError` and is registered `❌` in the compat-matrix (a flagless `ls` silently honoring `-R` is worse than throwing). Each builtin defines its GNU-faithful exit code (e.g. grep tri-state 0/1/2) — load-bearing *today* because `&&`/`||` short-circuit already ships; stderr goes to fd2, fds kept separate internally and merged only at the xterm sink.
- **uutils/picomatch are gated future ADRs**, not closed doors: revisit on verified need, alongside ripgrep-WASM (Q-2026-05-30-061). Adopting A is the explicit on-ramp to a later B/C.
- **busybox is permanently off the table** — license + Emscripten/WASI mismatch; no future ADR reopens it (uutils is the WASM substitute if one is ever wanted).
- `vfs-grep` gets promoted to a shared grep/walker home (rewired onto `syncMirror()` field-form Dirent) and a `grep` builtin; the Q-2026-05-30-061 `TODO(ADR)` marker stays for the *ripgrep-WASM* deferral, which this ADR does not resolve.
- **Enabling cross-links (this strategy is inert without them):** ADR-0089 (CommandContext stdin/isTTY/cancellation — gates stdin-filter modes, TTY-gated color, long-running vite/node), ADR-0091 (tokenizer rich-token-type + single-segment glob — `* ? [...]` expansion with quote-provenance), ADR-0093 (shell-command parity harness — node-parity-runner has no `ls`/`grep`/`find` oracle, so the parity claim is unsubstantiated until 0086 lands). ADR-0090 (VFS cp/mv primitives) gates cp/mv; ADR-0092 records the git contract.
- Color/width fidelity is a known ASCII-only limitation (hand-rolled SGR won't match `$LS_COLORS`; columns ignore wcwidth/CJK) — documented, not hidden.

## Reversibility classification

**IRREVERSIBLE** at the strategy level — it sets the dependency/vendoring posture for the entire command surface (checklist item 2: gates new deps uutils/picomatch; item 1/4: rejecting busybox and committing to a pure-JS-first surface shape across packages). Hence this ratified ADR.

**REVERSIBLE** at the per-command level — each new pure-JS builtin that uses only the *existing* CommandContext is a zero-dep, no-public-API-change addition needing no ADR (reverting one is a few lines in `packages/shell`). A builtin requiring a *new* CommandContext field is gated by ADR-0089; one requiring a new VFS primitive by ADR-0090; the tokenizer/glob change by ADR-0091.

## Acceptance

- [ ] No new runtime dependency added to `@riftydev/shell` `package.json` (nor to any package) as a result of adopting this strategy — verifiable in the dependency diff.
- [ ] busybox is not vendored: no `busybox.wasm` (or equivalent GPL-licensed coreutils binary) artifact, fetch, or build step anywhere in the repo.
- [ ] uutils/coreutils WASM and picomatch are absent from the tree and are recorded as deferred (future ADR / Q-2026-05-30-061 sibling) — not silently introduced.
- [ ] Research doc `docs/research/rich-terminal-coreutils-2026-06-06.md` is linked from this ADR (done, Context).
- [ ] This ADR is listed in `docs/adr/README.md` index (row 0081).
- [ ] Sibling ADRs 0082 (CommandContext), 0083 (VFS cp/mv), 0084 (tokenizer/glob), 0086 (parity harness) are cross-referenced as the enabling decisions; 0085 (git contract) noted.
- [ ] New pure-JS builtins land in `packages/shell` over `syncMirror()`, zero-dep; T1 tooling stays `registerCommand`-injected (not baked into builtins).
- [ ] Any unimplemented flag/applet throws `NotImplementedError` and is marked `❌` in the compat-matrix — no silent-stub placeholder return.
