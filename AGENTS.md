# AGENTS.md — binding rules, all coding agents (Codex, Claude Code, …)

Browser Node-compatible runtime + WASI runner (WebContainers-like project). `CLAUDE.md` = symlink here; edit here.

# Mission
Bring the **Node.js stack to the browser, maximally faithful to real Node** — same observable behavior, proven against real Node, never approximated. Roadmap + milestones: `docs/ROADMAP.md`.
Scope (first year): real Node programs (Express, pure-JS CLIs) + WASI binaries (esbuild/sqlite) on fresh Chromium; plus the isolate host — a Node service runs a rifty guest in a V8 isolate (ADR-0557; orchestration/deploy stay outside rifty). **Not goals:** full Node compat, node-gyp/native modules, production perf, non-Chromium browsers beyond the measured tiers (ADR-0469), own JS engine — gaps stay honest loud throws (see Fidelity), never silent stubs.
Anchor every discussion — architecture, bugs, trade-offs — to this goal + user scenarios; that's the tie-breaker.

## Fidelity — non-negotiable
Never trade real behavior for speed of delivery; never propose a shortcut, mock, or "do it later". Concretely:
- **No fake implementations.** Missing feature → throw `NotImplementedError('module.feature')` + compat-matrix ❌. Never a placeholder `null`/`''`/`undefined` or happy-path stub that lies.
- **No "implement later" / silent backlog.** Every gap is explicit (NotImplementedError, backlog item, compat ❌) — never hidden behind a passing path.
- **No mocking what we build.** Real Memory VFS, real Workers/SW, real npm tarballs, real parity vs Node. Mock only unavoidable external boundaries (network egress, clock, absent browser APIs); never the unit under test or a sibling rifty package. Hard to instantiate = API smell — fix it.
- **Similar but different must work.** If "X works" needs exact `X@V`, rifty-patched bytes or a narrowed admission, X is a declared ceiling, not supported: compat ⚠️, inventory row with class/authority/kill condition (`docs/process/rules/fault-classes.md` §Guest-package adaptations). Never a silent fix, never a starter pin.
- **Parity = gold standard.** Never assume Node/Anthropic/StackBlitz behavior — verify via parity-runner. Found gap/bug → failing parity (or regression) test first, then fix; no fix merges without it; never edit a test to make code pass.
- **A throw is not a way to meet a goal.** A throw / compat ❌ for behavior that real Node and rifty already perform is a fake — never satisfy the letter of an invariant with it.
- **Goal vs reality → the user decides.** `goal.md` (outcome, scenario, invariants, tier) is user-owned. It contradicts observed behavior, or can't be met as written → ask the user, probe/RED attached; continue whatever the question doesn't block; never narrow, drop or reinterpret it yourself.

## Architecture — hard rules
- Import boundaries enforced by `pnpm check:arch` (rules `tools/checks/arch-rules.cjs`): layer top-down (vfs/io/net → kernel → runtime-* → shell/terminal/npm-client → playground), no reverse imports, no cycles, no foreign `src/internal/*`, solid-js only in playground (D-002).
- Source dir > 30 direct prod files carries an owner `README.md` (what belongs / what doesn't) — `pnpm check:dir-owner`. A dir no rule can describe is not a layer: split it.
- Prod source file ≤ 800 lines — `pnpm check:file-size`. Ratchet: today's oversized files are pinned at current size and may only shrink; new ones refused. Past ~800 lines no reader gets the file in one call, so every question about it costs another window (burn-down: `backlog/toolchain-build/oversized-source-burndown.md`).
- New coordination mechanism (correlation, per-key FIFO, epoch guard, ledger, lock) → mechanism sweep first: `docs/process/rules/fault-classes.md` §Class-kill.
- **Simplicity.** The smallest honest mechanism that meets the contract. No speculative generality: a mechanism/layer/knob/abstraction the contract is deliverable without doesn't ship. Simplicity never trades against Fidelity: cut machinery, not behavior; gaps stay loud throws.
- Public API only via `src/index.ts`.
- No `any`; `@ts-ignore` only with why-comment + tracking issue.
- No hardcoded external URLs — env-config (D-004).
- Comments/ADRs/docs: extremely concise, sacrifice grammar, cut anything restating code.

## Data sources
- `docs/backlog/` — provisional contracts: items + user-value epics (`goal.md` = user-owned destination); delete on done; store shape + goal write-up (FIT): `docs/backlog/README.md`. User-brought idea/finding (in session) → `rifty-refine`; mid-task/agent discovery that must wait → `rifty-to-backlog`, never interview; epic missing tier/Invariants → fit it yourself (in the session that has the user) — a write-up is never a blocked ask. A `draft` goal carries an unanswered user question: ask, don't build.
- `docs/adr/` — decisions + strategic choices; index + D→ADR map: `docs/adr/README.md`
- `docs/process/traps.md` — hard-won gotchas (worktrees/git, CI, e2e, browser runtime, tooling); check before debugging a weird fail or re-proposing a rejected speedup
- `docs/process/rules/fault-classes.md` — fault taxonomy; `docs/process/rules/testing.md` — test pyramid + why parity
- `docs/public/` — compat matrix, publishing, hosting

## Confirm-first
Only publish, spend, delete user data. Everything else: decide and continue; the one question is a goal conflict (§Fidelity).

## DoD (per PR)
- [ ] implementation aligned with project goal
- [ ] no machinery the contract is deliverable without (§Simplicity)
- [ ] `pnpm pr:check` pass — lanes follow the diff since the origin/main merge-base: a docs-only tree runs the doc gates; otherwise `test:run` covers the tests related to the changed files and `test:parity` runs only when its inputs changed (`--all` forces the full gate, which CI runs on every non-docs PR push); a `test:run` red reruns its failed files once in isolation and says so (time-outs counted; a failure that reproduces stays red)
- [ ] merged only on a green PR CI at HEAD (`gh pr checks`, not a local gate)
- [ ] touches cache/persistence/network/concurrency → covered by fault tests (`docs/process/rules/fault-classes.md`)
- [ ] shipped capability carries observable acceptance proof (e2e/parity) in the same PR — source greps, fakes, and opt-in lanes do not close acceptance
- [ ] `CHANGELOG.md` in affected packages
