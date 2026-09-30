# Text-only content — I6

Baseline: e999915ff (previous accepted slice; main includes PR359).
Native provider: Pi0.85.1. Its OpenAI conversion constructs user parts and
assistant null; `onPayload` runs after construction before HTTP (installed
`dist/api/openai-completions.js:204,929-961`).

RED command (2026-09-30):
`pnpm test:run packages/agent/src/text-content.test.ts`
6 expected failures, 1 unflagged control passes, exit1. Failures: strict endpoint
leaves session error; image send resolves instead of rejecting; historical image
reaches endpoint; both native completion methods retain array content; invalid
flag accepted. No import/compile failure. `pnpm --filter @riftydev/agent typecheck`
passes. Raw RED: `/tmp/rifty-pr357-text-content-red.log`.

Tests use real Pi transport and real MemoryVfs file tools. Only scripted model
HTTP is substituted; the strict endpoint rejects every nonstring content field.

GREEN: text-content/catalog/images suites18/18; agent typecheck passes. Added
caller-content override proof for Contract+RED advisory. Executed mutant moving
shaping before caller `onPayload`: test `string shaping follows` fails with array
instead of string, exit1; original source restored. Raw artifact:
`/tmp/rifty-pr357-text-content-order-mutant.log`.
