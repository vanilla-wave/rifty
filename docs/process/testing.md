# Testing — pyramid, parity, mocks

Binding rules: `AGENTS.md` §tests. Here: why + tiers.

## Gold standard — Node Parity Runner
Same code in real Node and rifty, diff stdout. External reference — agent can't cheat. `tools/node-parity-runner/`; case = `setup` + `code` + `expected`. Any discrepancy = bug.

## Pyramid
- Unit — package-local logic (Vitest)
- Parity — vs real Node API (parity-runner + Vitest)
- Conformance — documented Node semantics out of parity reach (event-loop order, async timers, errors)
- Integration — real npm tarballs, tiers `tier-0-utility`…`tier-4-tooling`; each green package pinned by regression test
- E2E — playground via Playwright (chromium default)
- Smoke — basic post-build scenarios
- Compat matrix — auto-generated, `docs/public/compat/`

## Mock policy — minimal mocks
Real over fake every tier: parity runner vs real Node, Memory VFS backend (real impl, not mock), real tarballs, real Workers/SW in e2e. Mock/stub only unavoidable external boundaries (network egress, clock, browser APIs absent in test env); prefer fake with real semantics over per-test mock. Never mock unit under test or sibling rifty package; hard-to-instantiate dep = API-design smell — fix, don't mock around.

## Bug → regression test (mandatory)
Every found bug/problem → test failing before fix, passing after; prefer parity case. No fix merges without it.
