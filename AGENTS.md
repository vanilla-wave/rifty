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
- **Review convergence.** Parity/stateful changes pass two checkpoints (Contract+RED → Final+GREEN); protocol + blocker requirements: `docs/process/fault-classes.md` §Review convergence.

## Architecture — hard rules
- Import boundaries enforced by `pnpm check:arch` (rules `tools/checks/arch-rules.cjs`): layer top-down (vfs/io/net → kernel → runtime-* → shell/terminal/npm-client → playground), no reverse imports, no cycles, no foreign `src/internal/*`, solid-js only in playground (D-002).
- Source dir > 30 direct prod files carries an owner `README.md` (what belongs / what doesn't) — `pnpm check:dir-owner`. A dir no rule can describe is not a layer: split it.
- New coordination mechanism (correlation, per-key FIFO, epoch guard, ledger, lock) → mechanism sweep first: `docs/process/fault-classes.md` §Class-kill.
- **Simplicity.** The smallest honest mechanism that meets the contract. No speculative generality: a mechanism/layer/knob/abstraction the contract is deliverable without doesn't ship (review blocks it — `rifty-review` axis 4). Simplicity never trades against Fidelity: cut machinery, not behavior; gaps stay loud throws.
- Public API only via `src/index.ts`.
- No `any`; `@ts-ignore` only with why-comment + tracking issue.
- No hardcoded external URLs — env-config (D-004).
- Comments/ADRs/docs: extremely concise, sacrifice grammar, cut anything restating code.

## Data sources
- `docs/backlog/` — provisional contracts: items + user-value epics; delete on done. Route: new finding/idea → `rifty-to-backlog`; settled draft → compile + judge verdict (`decision-workflow.md` §Backlog readiness); unresolved observable fork → request manual `rifty-refine`; unsettled fork inside a `ready` item → demote first (same §); ready → implement normally; PR review → `rifty-review`. Never implement a draft. Planned/process work never invokes `rifty-fix`.
- `docs/adr/` — decisions + strategic choices; index + D→ADR map: `docs/adr/README.md`
- `docs/process/decision-workflow.md` — read at any fork
- `docs/process/fault-classes.md` — fault taxonomy + review convergence
- `docs/process/testing.md` — test pyramid + why parity
- `docs/public/` — compat matrix, publishing, hosting

## Decisions — decide, record, continue; never stop to ask
Full checklist + subagent budget: `docs/process/decision-workflow.md`. Core:
- REVERSIBLE behavior-preserving → CHANGELOG line.
- REVERSIBLE + judgment call → `docs/backlog/<area>/<slug>.md` + `// TODO(backlog: <area>/<slug>)`.
- IRREVERSIBLE (public API / new dep / contradicts ADR / genuine design choice) → `pnpm adr:new <area> "Title"`.
- Overturn recorded decision → decision subagent → superseding ADR. Active ADRs immutable; superseded = removed + pointer in `docs/adr/README.md`.
- Confirm-first only: outward/destructive beyond repo (publish, spend, shared-remote push, delete user data).

## Autonomous goals

Explicit whole-ready-epic hand-off or a `Goal-Baseline` task/PR → run loop:
`docs/process/decision-workflow.md` §Autonomous goals; data contract:
`docs/backlog/README.md` §Autonomous goal.

## DoD (per PR)
- [ ] no unrecorded/misclassified residuals; active-goal residuals stay linked; report slice/goal status separately
- [ ] implementation aligned with project goal
- [ ] no machinery the contract is deliverable without (§Simplicity)
- [ ] `pnpm pr:check` pass
- [ ] touches cache/persistence/network/concurrency → `## Fault matrix` rows covered by fault tests
- [ ] shipped capability carries observable acceptance proof (e2e/parity) in the same PR — source greps, fakes, and opt-in lanes do not close acceptance
- [ ] `CHANGELOG.md` in affected packages
- [ ] ADR for IRREVERSIBLE / backlog for provisional
