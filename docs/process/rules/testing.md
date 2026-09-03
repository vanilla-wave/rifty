# Testing — pyramid + why parity

Binding rules: `AGENTS.md` §Fidelity. Here: tiers + why parity is the gold standard.

## Gold standard — Node Parity Runner
Same code in real Node and rifty, diff stdout. External reference — agent can't cheat. `tools/node-parity-runner/`; case = `setup` + `code` + `expected`. Any discrepancy = bug.

## Pyramid
- Unit — package-local logic (Vitest). Framework-free Workbench contracts prove state, ordering, failure, and close behavior; Playground adapter tests prove only product/presentation policy over public semantic handles (ADR-0292)
- Browser-unit — worker-side playground modules against the REAL owner worker under COI, no App boot (ADR-0196): `pnpm test:browser-unit`, `tests/browser-unit/`, harness `apps/playground/unit-harness.html`. Belongs here: owner boot/bridge/worker-realm contracts. Does NOT belong: UI scenarios (e2e), pure logic (unit)
- Parity — vs real Node API (parity-runner + Vitest)
- Conformance — documented Node semantics out of parity reach (event-loop order, async timers, errors)
- Integration — real npm tarballs, tiers `tier-0-utility`…`tier-4-tooling`; each green package pinned by regression test
- Fault — inject one fault axis at a boundary (network/storage/cache/concurrency) → assert the honest outcome; axes + outcome contract: `fault-classes.md`
- E2E — playground via Playwright (chromium default)
- Smoke — basic post-build scenarios
- Compat matrix — auto-generated, `docs/public/compat/`

Source-grep tests (`expect(source).toContain`) are forbidden. `pnpm
check:source-grep` guards the playground surface; allowlisted exceptions require
why behavioral proof is impossible.
