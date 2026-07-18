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
- Fault — inject one fault axis at a boundary (network/storage/cache/concurrency) → assert the honest outcome (fallback / degraded / loud throw, never a silent lie); axes + contract: `docs/process/fault-classes.md`
- E2E — playground via Playwright (chromium default)
- Smoke — basic post-build scenarios
- Compat matrix — auto-generated, `docs/public/compat/`

Anti-pattern (ratcheted): source-grep tests (`expect(source).toContain`) — `pnpm check:source-grep` refuses new ones across the playground test surface (`apps/playground/src` unit tests + `tests/browser-unit` specs); residual pins live in the ALLOWLIST (`tools/checks/source-grep-ratchet.mjs`), each with an enforced why-behavioral-is-impossible. Pre-existing greps in other packages: backlog `toolchain-build/source-grep-ratchet-repo-wide`.
