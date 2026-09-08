# Copyable Workbench runtime assets

## Baseline and RED — 2026-09-08

Baseline c798a8e84a6d1489c89aeefe3788ceda7d0570e5; Node24.16.0,
Playwright1.60.0, Vitest2.1.9.

`pnpm test:packed-consumer` builds/packs the real packages and typechecks the
consumer. Its build now first copies the published runtime directory:
`AssertionError: packed Workbench contains copyable runtime assets`.
This is the expected missing-artifact assertion, not an import/typecheck failure.

The host main uses ordinary URLs for all six Worker entries, SW and WASM;
Vite host aliases/worker compilation settings are absent. The existing kernel
wrapper/alias source files remain only as prior test references until their
ownership moves to publishing during implementation. The completed host needs
neither file. `copy-assets.mjs` copies all relative chunks, not just entry names.

The unchanged packed browser journey remains real Vite7.3.6/HMR/SQLite plus
producer raw/HTTP-decoded snapshot restore. The added copied toolchain probe
uses existing public SDK/VM behavior (`runInNewContext('40 + 2')`), guarding the
lexical compiler closure; it adds no SDK/runtime policy.

Prior source-wrapper timing criteria are kept and retargeted to the package-
owned wrapper; published builtin-alias targets remain verified. No test is
weakened to accept a missing runtime. Package source exports remain unchanged.

`pnpm lint`, `pnpm backlog:check`, `pnpm refs:check` pass on preparation.
Producer's additional retained-acquisition test passes10/10 without code changes;
it is prior-slice hardening, not a new asset obligation.
