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
- **Review convergence.** Parity/stateful changes get two checkpoints: Contract+RED, then Final+GREEN. Each correctness blocker gets a fault class, RED test, and sibling sweep in the PR. A repeated class or review-born state owner stops point fixes: redesign or split. Protocol: `docs/process/fault-classes.md` §Review convergence.

## Architecture — hard rules
- Import boundaries enforced by `pnpm check:arch` (rules `tools/checks/arch-rules.cjs`): layer top-down (vfs/io/net → kernel → runtime-* → shell/terminal/npm-client → playground), no reverse imports, no cycles, no foreign `src/internal/*`, solid-js only in playground (D-002).
- Source dir > 30 direct prod files carries an owner `README.md` (what belongs / what doesn't) — `pnpm check:dir-owner`. A dir no rule can describe is not a layer: split it.
- New coordination mechanism (correlation, per-key FIFO, epoch guard, ledger, lock) → mechanism sweep first: `docs/process/fault-classes.md` §Class-kill.
- Public API only via `src/index.ts`.
- No `any`; `@ts-ignore` only with why-comment + tracking issue.
- No hardcoded external URLs — env-config (D-004).
- Comments/ADRs/docs: extremely concise, sacrifice grammar, cut anything restating code.

## Data sources
- `docs/backlog/` — open/provisional work: items (`docs/backlog/<area>/<slug>.md`) + epics (`docs/backlog/epics/`, a user-value umbrella over items). Status `draft|ready` (epics also `in-progress`); closure = delete-on-done (no "done" status). `ready` = a contract an implementer can't close with an approximation (Acceptance / Parity cases / Out-of-scope loud-throw / Decisions). **Findings enter via the `rifty-to-backlog` skill (capture); never hand a `draft` to an implementer — two paths to `ready`: open forks → the `rifty-refine` skill (user-tier); fork-free → write the contract + fresh-context judge verdict, never self-certified. Epic envelope (Outcome/Scenario/Invariants/tier/Out-of-scope/Budget) is frozen for the run; `## Items` is a living plan.** Canon: `docs/process/decision-workflow.md` §Backlog readiness.
- `docs/adr/` — decisions + strategic choices (D-001..D-006: V8 engine, WASI-separate, Workers-as-processes, SW-networking, OPFS/VFS); index + D→ADR map: `docs/adr/README.md`
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

## DoD (per PR)
- [ ] no new deferred decisions or tech debt
- [ ] implementation alligned with project goal
- [ ] `pnpm pr:check` pass
- [ ] touches cache/persistence/network/concurrency → `## Fault matrix` rows covered by fault tests
- [ ] review convergence gates satisfied: Contract+RED; Final+GREEN with 0 blockers; required finite checks green on one SHA
- [ ] shipped capability carries observable acceptance proof (e2e/parity) in the same PR — source greps, fakes, and opt-in lanes do not close acceptance
- [ ] `CHANGELOG.md` in affected packages
- [ ] ADR for IRREVERSIBLE / backlog for provisional
