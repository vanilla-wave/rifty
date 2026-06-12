# AGENTS.md — binding rules, all coding agents (Codex, Claude Code, …)

Browser Node-compatible runtime + WASI runner (WebContainers-like pet project). `CLAUDE.md` = symlink here; edit here.

## Sources of truth (order; conflict → ROADMAP+ADRs win over priors)
1. This file — session rules
2. `docs/ROADMAP.md` — milestones M0–M12 + acceptance
3. `docs/adr/` — decisions; index + D→ADR map: `docs/adr/README.md`
4. `docs/backlog/` — open/provisional work
5. `docs/process/decision-workflow.md` — read at any fork
6. `docs/process/testing.md` — test pyramid + mock policy
7. `docs/ARCHITECTURE.md` — vision, layers, isolation, IPC
8. `docs/public/` — compat matrix, publishing, hosting

No prior-session assumptions — re-read ROADMAP + active ADRs each session.

## Workflow
Task → ROADMAP milestone + acceptance criteria → **failing test first** (prefer parity) → implement → full local verification → CHANGELOG/ADR/backlog → PR links milestone/etap.

## Hard rules — architecture
- Layers top-down only: vfs/io/net → kernel → runtime-js/runtime-wasi → shell/terminal/npm-client → apps/playground. No reverse imports; no cycles (madge CI).
- Public API only via `src/index.ts`; never another package's `src/internal/*`.
- `solid-js` only in `apps/playground/**` (D-002).

## Hard rules — code
- No `any`; `@ts-ignore` only with why-comment + tracking issue.
- No silent stubs: throw `NotImplementedError('module.feature')` + compat-matrix ❌. Never placeholder `null`/`''`/`undefined`.
- No hardcoded external URLs — env-config (D-004).
- No file-size cap — split by concept.
- Comments/ADRs/docs: extremely concise, sacrifice grammar, cut anything restating code.

## Hard rules — tests
- **Found bug/problem → MUST add regression test** failing before fix (prefer parity case). No fix without test.
- **Minimal mocks:** real things — parity runner vs real Node, Memory VFS, real npm tarballs, real Workers in e2e. Mock only unavoidable external boundaries (network egress, clock, missing browser APIs). Never mock unit under test or sibling rifty package.
- Never modify test to make code pass — file issue.
- Parity tests (`tools/node-parity-runner/`, diff stdout vs real Node) = gold standard. Never assume Node behavior — verify via parity runner.
- No coverage-padding tests; each test = articulable failure mode.

## Decisions — decide, record, continue; never stop to ask
Full checklist + subagent budget + anti-patterns: `docs/process/decision-workflow.md`. Core:
- REVERSIBLE behavior-preserving → CHANGELOG line.
- REVERSIBLE + judgment call → `docs/backlog/<area>/<slug>.md` + `// TODO(backlog: <area>/<slug>)`.
- IRREVERSIBLE (public API / new dep / contradicts ADR / genuine design choice) → `pnpm adr:new <area> "Title"`.
- Overturn recorded decision → decision subagent → superseding ADR. Active ADRs immutable; superseded = removed + pointer in `docs/adr/README.md`.
- Subagents: max depth 1 default; code-editing agents = disjoint file ownership.
- Confirm-first only: outward/destructive beyond repo (publish, spend, shared-remote push, delete user data).

## DoD (per PR)
- [ ] Tests pass (unit + parity + relevant conformance); new behavior covered, parity case where applicable
- [ ] TS strict, Biome, `pnpm check:deps` green; TSDoc on new public API
- [ ] `CHANGELOG.md` in affected packages
- [ ] ADR for IRREVERSIBLE / backlog for provisional; `pnpm docs:check` green
- [ ] compat-matrix regen only at milestone DoD (`pnpm compat:generate`, A-033)
- [ ] PR links milestone/etap

## Commands
```bash
pnpm install / dev / typecheck / lint / check:deps
pnpm test          # unit watch; test:run = single
pnpm test:parity / test:conformance / test:integration / test:e2e / test:e2e:all / test:all
pnpm compat:generate / backlog:check / refs:check / docs:check
pnpm adr:new <area> "Title"
```

---
*Reviewed each milestone close, with `docs/backlog/` (promote/rollback provisional). Recurring problem → propose rule here.*
