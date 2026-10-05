# ADR 0500: Installed CLI capability admission before native execution

Status: Accepted
Date: 2026-10-02
Partially supersedes ADR-0174 preparation/command-semantics boundary; extends ADR-0384.

## Context

I7 requires named unclaimed Vitest modes. Real watch runs tests and waits;
non-TTY input correctly bypasses readline's existing ceiling (ADR-0230).
Native parser/actual-CLI probes: docs/backlog/runtime-js/reference/vitest-cli-admission-oracle.json and
docs/backlog/runtime-js/reference/vitest-cli-envelope-info-probe.json; Node 24.16.0, exact 4.1.11/8.0.16.

## Decision

Registry may refuse explicitly unclaimed installed-CLI capabilities before entry.
Match actual target against nearest installed manifest's declared bin, exact
Vitest 4.1.11 / resolved Vite 8.0.16; arbitrary user files stay generic.
Canonical raw-first run is admitted. Native public parseCLI owns its argument
projection; watch truthiness controls run action, including run --watch --run.
Other command shapes are an honest vitest.cli-shape ceiling, not a claimed Node gap.
Root single-token help/version bypass inspection and execute installed CLI once.
Canonical helper-help has already executed native info behavior: handled returns
through ordinary drain/exit, preserving preloads, timers, exitCode and exit events.
Run --version remains an action. Coverage, browser, DOM and vm pools stay named ceilings.

One generic Node-entry beforeEntry callback runs after preloads with the same
real loader/cache and actual target; default continues, handled means native
entry behavior already completed. No second loader, argument rewrite, console
suppression, source-shape patch, owner command, registry extension or new protocol.

Only ADR-0174's categorical ban on capability admission in preparation is
superseded. Installed-bin ownership, native behavior for admitted paths,
server-capable lifecycle and observation-only UX remain. Existing Vite policy,
ADR-0155/0157 process authority and ADR-0230 non-TTY stdin remain.

## Alternatives

- Damage generic fs.watch/readline/TTY to force the old ceiling: rejected by native non-TTY proof.
- Upstream source patch/owner command: rejected by I7 and installed-bin ownership.
- Finite metadata admission + actual parser/shared loader: chosen; no fake execution.
- Parser output as universal mode grammar: rejected; native action precedence/info effects differ.

DEC-2 independent review: watch_admission_decision; raw decisions/probes in
docs/backlog/runtime-js/reference/vitest-watch-decision.md and docs/backlog/runtime-js/reference/vitest-admission-envelope-decision.md.

## Proof

Captured watch RED; Node option matrix; real Chromium run/fail/fix/both pools,
info once and named negative cases. Final+GREEN establishes delivery status.
