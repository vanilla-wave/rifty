# Consumer-fit implementation evidence

Date: 2026-09-16. PR #340; baseline `3ee25558ff745602e88c382be9b5c229e05b2630`.
Authority: `workbench-sandbox-support-consumer-fit.md`, consumer evidence/challenge.

## Root cause and class sweep

`check-sandbox-support.ts` accepts missing configuration before seeding observations;
its omission branch labels only three asset rows, leaving other rows unexplained.
`report.ts` projects failed/incomplete rows to free text, dropping their identity.
Boundary: owned in-process policy projection; axes `corrupt-input`, `lossy-aggregate`.
One validation entry and one shared `summarize` serve both modes; repair those owners.
Sweep: `rg` for `checkSandboxSupport`, `SandboxSupportMode`, `probeBaseUrl`, mode
reasons/limitations across packages/apps/tests/examples/tools/docs/public. Callers:
native browser suite and public guide; no second implementation or coordination
mechanism. Existing Worker/SW/OPFS fault surface and tests remain intact; no strikes.

## Independent DEC-2 decision

Fresh read-only reviewer `/root/consumer_decision`, depth 1, no children, baseline
above. Read ADR-0437, consumer records and implementation. Runtime not run by reviewer.
Verdict: accepted; no contract blockers.

- Overturn ADR-0437 decision 2's omission-as-incomplete sentence; async calls reject
  with `TypeError` before probes. Decision 1's optional-argument signature changes
  accordingly; its report sections/states/reasons remain. Decisions 3–5 retained.
- Uniform omission text would preserve a call that cannot ever yield supported;
  required configuration removes that permanent misconfiguration from inconclusive.
- IDs avoid duplicating check objects or parsing their reason strings. Rename
  `reasons` to `unmet`; both summary lists carry `SandboxSupportCheckId`.
- Host Web Locks remain host prerequisites. Keep module-SW probing: SDK registers
  module SW by default. No extra `require:` or SW opt-out needed.
- Guide must mention that `nonCoiVmEngine: 'quickjs'` already makes WASM required.

## RED before implementation

Command: `RIFTY_PLAYGROUND_PORT=5391 pnpm exec playwright test --config
playwright.browser-unit.config.ts tests/browser-unit/sandbox-support.spec.ts
--grep 'missing probe configuration|real non-COI prerequisites|SW registration denial|storage-denied:'`.
Log: `/tmp/pr340-consumer-red.log`. Exit 1; four behavioral failures, no load/type errors.

- Missing options, empty options and explicit undefined URL each resolve a report;
  expected `TypeError` naming `probeBaseUrl`. Test also observes context reads to
  detect probes before validation.
- Real non-COI, SW-denial and storage-denial reports still expose `reasons` with
  text. Tests require `unmet`/`limitations` IDs resolving to exactly one check row.
- Former omission expectation deliberately superseded by accepted Acceptance 1;
  reason-text assertions superseded by Acceptance 2. Native fault scenarios retained.
