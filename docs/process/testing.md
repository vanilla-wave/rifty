# Testing — pyramid + why parity

Binding rules: `AGENTS.md` §Fidelity. Here: tiers + why parity is the gold standard.

## Gold standard — Node Parity Runner
Same code in real Node and rifty, diff stdout. External reference — agent can't cheat. `tools/node-parity-runner/`; case = `setup` + `code` + `expected`. Any discrepancy = bug.

## Pyramid
- Unit — package-local logic (Vitest)
- Parity — vs real Node API (parity-runner + Vitest)
- Conformance — documented Node semantics out of parity reach (event-loop order, async timers, errors)
- Integration — real npm tarballs, tiers `tier-0-utility`…`tier-4-tooling`; each green package pinned by regression test
- Fault — inject one fault axis at a boundary (network/storage/cache/concurrency) → assert the honest outcome (fallback / degraded / loud throw, never a silent lie); axes + contract: `docs/process/fault-classes.md`
- E2E — playground via Playwright (chromium default)
- Smoke — basic post-build scenarios
- Compat matrix — auto-generated, `docs/public/compat/`
