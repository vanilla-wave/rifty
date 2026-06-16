---
area: runtime-js
status: parked
title: node:vm test-pinning follow-ups — membrane caveats + parity expected baselines
created: 2026-06-14
why: two ADR-0142 membrane caveats are documented but pinned by no test, and several quickjs parity cases rely only on the live Node-diff oracle with no committed expected baseline — both leave a regression undetected if behavior or the Node oracle shifts
user_story: As a maintainer, I want every documented vm divergence and reconciliation caveat pinned by a test (like the four ES2023≠V8 residuals are), so a silent regression toward or away from the recorded behavior fails loudly.
sources: [ADR-0142, runtime-js/vm-unwired-seams]
code: [packages/runtime-js/src/builtins/vm/membrane.ts]
---
## Context
Coverage asymmetry left by the ADR-0142 vm work:

- The two membrane reconciliation caveats — a guest CALLBACK mutating the sandbox
  AFTER the synchronous run is seen only at the next reconciliation; structurally
  REMOVING a key from a NESTED host object between runs is not reflected
  (overwrite/add only) — are recorded in ADR-0142 + `membrane.ts` but pinned by no
  parity/conformance/unit assertion. The four ES2023≠V8 residuals, by contrast, are
  each pinned both ways.
- Six quickjs parity cases (`quickjs-inbound-methods`, `quickjs-shared-state-runs`,
  `quickjs-structured-result`, `quickjs-template-closure`, `quickjs-config-loader`,
  `quickjs-context-arg-errors`) omit the optional `expected` byte-baseline, so they
  verify only via the live Node diff (still a real oracle, but no committed baseline
  if the Node version shifts).

## Options or Next
- Add conformance assertions pinning the two caveats as rifty's documented behavior
  (NOT parity — they diverge from Node by design).
- Backfill `expected` baselines on the six Node-diff-only cases.

## Reversibility
REVERSIBLE — test-only additions; no behavior or API change.
