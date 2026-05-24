# CLAUDE.md

Browser-based Node-compatible runtime + WASI runner. Pet project, goal is deep understanding of how WebContainers-like systems work, plus practical "Express + npm install in browser" within ~year of evening work.

See `PROJECT_PLAN.md` for the master plan.

## Sources of truth (read in this order)

1. **`PROJECT_PLAN.md`** — architecture, milestones, decisions log (D-001..D-NNN)
2. **`docs/adr/`** — detailed rationale for each architectural decision
3. **`OPEN_QUESTIONS.md`** — provisional decisions awaiting human review (see D-007)
4. **`docs/compat/`** — what's known to work / not work
5. This file — rules for this session

If something conflicts, `PROJECT_PLAN.md` and ADRs win over your priors.

## Current context

- **Active milestone:** M10 (Real Tooling) — M0 through M9 complete (see `TASKS.md`)
- **Decisions in effect:** D-001 through D-007 (see `PROJECT_PLAN.md` §8)

## Workflow for any task

**Step 0. Classify the task before starting:**
- Pure implementation (criteria are clear from milestone) → proceed to Step 1
- Design decision needed → apply Reversibility checklist (see below)

**Steps 1-7:**
1. Read the task description; locate it in the relevant milestone
2. Check acceptance criteria for the milestone — your work serves these
3. **Write tests first.** If the change is behavioral, write a failing test (preferably a parity-runner case) before any implementation
4. Implement until tests pass
5. Run the full local verification (see Commands below)
6. Update CHANGELOG, compat-matrix, ADR (if applicable) — see Definition of Done
7. Open PR with clear linkage to milestone/etap

## Design decisions during work

When you encounter an unclear design choice during implementation, **do not stop unnecessarily**. Apply this:

### Reversibility checklist (order matters — first "yes" determines classification)

1. Does it touch public API between packages? → **IRREVERSIBLE**
2. Does it require a new external dependency? → **IRREVERSIBLE**
3. Does it contradict an existing ADR? → **IRREVERSIBLE**
4. Would reverting require >100 lines or >2 files changed? → **IRREVERSIBLE**
5. Otherwise → **REVERSIBLE**

### Actions by classification

- **REVERSIBLE:**
  - Make a provisional decision
  - Mark relevant code with `// TODO(ADR): Q-YYYY-MM-DD-NNN`
  - Log to `OPEN_QUESTIONS.md` using the template there
  - **Continue working.** Do not stop.

- **IRREVERSIBLE or contradicts existing ADR:**
  - Stop
  - Document the question in the PR description with options and trade-offs
  - Do not invent answers

### Things that are always reversible (no logging needed)
- Local variable naming, file structure inside a package
- Internal helper functions, private utilities
- Documentation wording, code comments
- Test descriptions (but not test logic — see Hard rules)

## Hard rules

These are non-negotiable. Violating any of them is a defect, regardless of how good the outcome looks.

### Architecture
- **No reverse imports.** Layers go top-down: vfs → kernel → runtime-* → net/shell → npm-client → playground. Never the other way.
- **No `solid-js` imports outside `apps/playground/**`.** UI framework is isolated (D-002).
- **Public API only via `src/index.ts`.** Never import from another package's `src/internal/*`.
- **No circular dependencies** (CI enforces via `madge`).

### Code quality
- **No `any` in TypeScript.** No `@ts-ignore` without an explicit comment explaining why and a tracking issue.
- **No silent stubs.** If you can't implement something, throw `NotImplementedError('module.feature')` and register in compat-matrix as `❌`. Never return `null`/`''`/`undefined` as a placeholder.
- **No hardcoded URLs to external services.** Configurable via env (e.g. npm registry URL — see D-004).
- **Files under ~300 lines.** Split when growing larger.

### Tests
- **Never modify a test to make code pass.** If a test seems wrong, that's a design discussion — file an issue, don't edit the test. (This is always IRREVERSIBLE per checklist.)
- **Parity tests are the gold standard.** When adding Node-compatible behavior, prefer adding a parity case (Node vs our runtime, diff stdout) over hand-written assertions.
- **Don't add tests just to bump coverage.** Each test must catch a specific failure mode you can articulate.

### Memory/state
- **Never assume previous session context.** Re-read `PROJECT_PLAN.md` and current ADRs at start of each session.
- **Decisions in `docs/adr/` are immutable after merge.** If you think one needs updating, write a new ADR that supersedes the old, with a reference.

## Definition of done (per PR)

- [ ] All existing tests pass (unit + parity + relevant conformance)
- [ ] New behaviors have new tests; parity case where applicable
- [ ] TypeScript strict passes; no new `any` / `@ts-ignore`
- [ ] Biome lint passes
- [ ] No new circular deps (`pnpm check:deps`)
- [ ] TSDoc on new public API
- [ ] `CHANGELOG.md` updated in affected packages
- [ ] compat-matrix regenerated if any conformance/integration changed (`pnpm compat:generate`)
- [ ] ADR added if an IRREVERSIBLE decision was made
- [ ] `OPEN_QUESTIONS.md` updated if any REVERSIBLE provisional decisions were made
- [ ] PR description links to milestone and etap

## Commands

```bash
# Setup
pnpm install                    # also installs Playwright browsers

# Development
pnpm dev                        # playground at localhost
pnpm typecheck                  # workspace-wide
pnpm lint                       # biome check
pnpm check:deps                 # madge circular check

# Tests
pnpm test                       # unit tests, watch mode
pnpm test:run                   # unit, single run
pnpm test:parity                # node parity runner, all cases
pnpm test:conformance           # conformance test suite
pnpm test:integration           # real npm packages
pnpm test:e2e                   # playwright in chromium (default)
pnpm test:e2e:all               # playwright in all 3 browsers
pnpm test:e2e:firefox           # firefox only
pnpm test:e2e:webkit            # webkit only
pnpm test:all                   # everything above sequentially

# Maintenance
pnpm compat:generate            # regenerate docs/compat/*.md from test results
pnpm adr:new "Title"            # scaffold new ADR
pnpm adr:promote Q-YYYY-MM-DD-N # promote OPEN_QUESTIONS entry to ADR, clean TODO(ADR) markers
pnpm todo:adr                   # report count of TODO(ADR) markers in code
```

## Anti-patterns (things you'll be tempted to do — don't)

### "Let me just stub this for now"
No. Throw `NotImplementedError` with a clear message. Stubs that return fake values create subtle bugs downstream.

### "The test is too strict, let me relax it"
No. Tests encode behavioral contracts. If you think one is wrong, file an issue and discuss — don't edit the test.

### "I'll skip the parity test, the unit test is enough"
For Node-compatible behavior, parity tests catch things unit tests can't (subtle semantic differences, edge cases). Default to parity unless there's a specific reason not to.

### "This pattern would be cleaner with a back-reference"
No reverse imports. If you find yourself wanting one, the abstraction in the lower layer is wrong — fix it there, not by inverting deps.

### "Let me add this convenient helper from npm — only 50 lines"
Each new dependency is a long-term commitment (and counts as IRREVERSIBLE per checklist). Check: is it broadly useful, or could I write the 50 lines myself? Bias toward zero-dep small helpers in `packages/*/src/utils/`.

### "I'll fix three things in this PR since I'm here"
One change per PR. Noticed unrelated issues? File separate tickets.

### "I'll stop and ask about this"
Apply the Reversibility checklist first. Most design questions are REVERSIBLE — log them in `OPEN_QUESTIONS.md` and continue. Stop only for IRREVERSIBLE.

## When in doubt

- Check if a similar pattern exists elsewhere (`rg` is your friend)
- Check the relevant ADR
- Apply the Reversibility checklist
- If still IRREVERSIBLE and unclear: stop and ask explicitly in PR description, don't guess
- Never assume Node/Anthropic/StackBlitz behavior without verifying — use the parity-runner to check Node's actual behavior

---

*This file is reviewed at the end of each milestone. If you encounter a recurring problem, propose adding a rule here. The `OPEN_QUESTIONS.md` is reviewed at the same time — provisional decisions get promoted to ADRs or rolled back.*
