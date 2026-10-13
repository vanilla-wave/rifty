# Real npm alias registry fixtures

Captured 2026-10-13 from public npm; Node v24.16.0/npm 11.17.0.
`packages.json`: exact 18-package closure of @isaacs/cliui8.0.2,
string-width4.2.3 and @types/estree1.0.7. Metadata and gzip bytes original;
SHA-512 checked before each parity run. Local HTTP server changes only
`dist.tarball` origin and supplies the captured versions.

`tests/integration/npm-alias.parity.test.ts` invokes real npm per scenario,
compares every visible dependency identity and original manifest bytes,
requires exact native-lock replay paths, then checks offline replay.
CJS string-width/strip-ansi output and module-instance identity match Node.

Fresh highest-possible hoisting remains ADR-0042/0303; no exact fresh layout
claim. wrap-ansi installed bytes/graph proven; its runtime requires the
separately captured ansi-styles getter-only module.exports fix.
