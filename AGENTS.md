# AGENTS.md — binding rules, all coding agents (Codex, Claude Code, …)

Browser Node-compatible runtime + WASI runner (WebContainers-like project). `CLAUDE.md` = symlink here; edit here.

# Mission
Bring the **Node.js stack to the browser, maximally faithful to real Node** — same observable behavior, proven against real Node, never approximated. Roadmap + milestones: `docs/ROADMAP.md`.
Scope (first year): real Node programs (Express, pure-JS CLIs) + WASI binaries (esbuild/sqlite) on fresh Chromium. **Not goals:** full Node compat, node-gyp/native modules, production perf, non-Chromium browsers, own JS engine — gaps stay honest loud throws (see Fidelity), never silent stubs.
Anchor every discussion — architecture, bugs, trade-offs — to this goal + user scenarios; that's the tie-breaker.

## Fidelity — non-negotiable
Never trade real behavior for speed of delivery; never propose a shortcut, mock, or "do it later". Concretely:
- **No fake implementations.** Missing feature → throw `NotImplementedError('module.feature')` + compat-matrix ❌. Never a placeholder `null`/`''`/`undefined` or happy-path stub that lies.
- **No "implement later" / silent backlog.** Every gap is explicit (NotImplementedError, backlog item, compat ❌) — never hidden behind a passing path.
- **No mocking what we build.** Real Memory VFS, real Workers/SW, real npm tarballs, real parity vs Node. Mock only unavoidable external boundaries (network egress, clock, absent browser APIs); never the unit under test or a sibling rifty package. Hard to instantiate = API smell — fix it.
- **Parity = gold standard.** Never assume Node/Anthropic/StackBlitz behavior — verify via parity-runner. Found gap/bug → failing parity (or regression) test first, then fix; no fix merges without it; never edit a test to make code pass.
- **Review checkpoints.** Parity/stateful changes pass Contract+RED before implementation, then Final+GREEN; blockers iterate in place within a declared budget. Rules: `docs/process/rules/review.md`, stops: `docs/process/rules/stops.md`.

## Architecture — hard rules
- Import boundaries enforced by `pnpm check:arch` (rules `tools/checks/arch-rules.cjs`): layer top-down (vfs/io/net → kernel → runtime-* → shell/terminal/npm-client → playground), no reverse imports, no cycles, no foreign `src/internal/*`, solid-js only in playground (D-002).
- Source dir > 30 direct prod files carries an owner `README.md` (what belongs / what doesn't) — `pnpm check:dir-owner`. A dir no rule can describe is not a layer: split it.
- Prod source file ≤ 800 lines — `pnpm check:file-size`. Ratchet: today's oversized files are pinned at current size and may only shrink; new ones refused. Past ~800 lines no reader gets the file in one call, so every question about it costs another window (burn-down: `backlog/toolchain-build/oversized-source-burndown.md`).
- New coordination mechanism (correlation, per-key FIFO, epoch guard, ledger, lock) → mechanism sweep first: `docs/process/rules/fault-classes.md` §Class-kill.
- **Simplicity.** The smallest honest mechanism that meets the contract. No speculative generality: a mechanism/layer/knob/abstraction the contract is deliverable without doesn't ship (review blocks it — `REV-7`). Simplicity never trades against Fidelity: cut machinery, not behavior; gaps stay loud throws.
- Public API only via `src/index.ts`.
- No `any`; `@ts-ignore` only with why-comment + tracking issue.
- No hardcoded external URLs — env-config (D-004).
- Comments/ADRs/docs: extremely concise, sacrifice grammar, cut anything restating code.

## Data sources
- `docs/process/README.md` — the process map: one frozen layer (`goal.md`), agent-owned path, stages, roles, closed stop list, rule ids (`DEC`/`RDY`/`REV`/`STOP`/`PR`). Read it first; cite rules by id.
- `docs/backlog/` — provisional contracts: items + user-value epics; delete on done. Route: user-brought idea/finding (in session) → `rifty-refine`; mid-task/agent discovery → `rifty-to-backlog`, never interview; draft → ready at pickup (`RDY-1..4`); epic missing tier/Invariants → fit it yourself (`rifty-goal` FIT) — a write-up is never a blocked ask; PR review → `rifty-review`. Never implement a draft. Planned/process work never invokes `rifty-fix`.
- `docs/adr/` — decisions + strategic choices; index + D→ADR map: `docs/adr/README.md`
- `docs/process/traps.md` — hard-won gotchas (worktrees/git, CI, e2e, browser runtime, tooling); check before debugging a weird fail or re-proposing a rejected speedup
- `docs/process/rules/fault-classes.md` — fault taxonomy; `docs/process/rules/testing.md` — test pyramid + why parity
- `docs/public/` — compat matrix, publishing, hosting

## Decisions — decide, record, continue; never stop to ask
Checklist + subagent budget: `docs/process/rules/decisions.md`. Core:
- REVERSIBLE behavior-preserving → CHANGELOG line.
- REVERSIBLE + judgment call → `docs/backlog/<area>/<slug>.md` + `// TODO(backlog: <area>/<slug>)`.
- IRREVERSIBLE (public API / new dep / contradicts ADR / genuine design choice) → `pnpm adr:new <area> "Title"`.
- Add a decision on a seam an ADR owns → new short ADR citing it; nothing removed, nothing grafted. Overturn a recorded decision → decision subagent → superseding ADR naming the overturned decisions; all overturned = old ADR removed + pointer in `docs/adr/README.md`, some = dated §Corrections note (`DEC-2`).
- Confirm-first only: publish, spend, delete user data (`DEC-3`). The only user stops in a run: `docs/process/rules/stops.md` `STOP-1`.

## Goal runs

Explicit whole-ready-goal hand-off → run loop per `docs/process/README.md` §Stages (`rifty-goal` skill routes to the stage docs; Claude: `.claude/workflows/goal-run.js`).

## PR — unit of delivery
One PR = one reviewable delivered behavior; rules `docs/process/rules/pr.md` (`PR-1..6`): discoveries ride the unit's branch, one draft PR per goal by default, a separate-PR demand names its gate, a user-asked PR is the user's call.

## DoD (per PR)
- [ ] no unrecorded/misclassified residuals; active-goal residuals stay linked; report slice/goal status separately
- [ ] implementation aligned with project goal
- [ ] no machinery the contract is deliverable without (§Simplicity, `REV-7`)
- [ ] `pnpm pr:check` pass — lanes follow the diff: a docs-only working tree runs the doc gates and names the skipped source lanes (`--all` forces the full gate); a `test:run` red reruns its failed files once in isolation and says so (time-outs counted; a failure that reproduces stays red)
- [ ] touches cache/persistence/network/concurrency → traced `## Fault matrix` rows covered by fault tests (`RDY-3`)
- [ ] shipped capability carries observable acceptance proof (e2e/parity) in the same PR — source greps, fakes, and opt-in lanes do not close acceptance
- [ ] `CHANGELOG.md` in affected packages
- [ ] ADR for IRREVERSIBLE / backlog for provisional
