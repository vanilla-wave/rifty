# Public T / npm / offline composition

Carrier: `tests/browser-unit/replica-public-scale.spec.ts`, required browser-unit
lane. Three independent profiles, four separate Chromium processes each.
Actual published worker build; executable sources use public Workbench APIs.

- T manifest: 15,568 files / 73,637,414 bytes. Per-path procedural data under
  `node_modules/.tracker-scale`, preserved across install. The original Tracker
  plugin is not executed or represented as installed package metadata.
- Actual upstream `ms@2.0.0` snapshot, then real `npm install`: 11 packages,
  5,420 distinct ordinary node_modules file writes. Every archive SHA-512
  verified; same program runs against native Node v24.16.0 as oracle.
- Fresh offline starts: Chromium offline before navigation, server destroys
  every connection, cached application/worker code only. Zero registry or
  snapshot requests. Node runs; edited source, all T paths/sizes and installed
  lodash behavior survive. Native selected root contains only the replica.
- Same compiled OpfsFsSync methods observed without replacing outcomes. Sum of
  all awaited first-open flushes: median 147.810 ms (upper bound on I1 tail).
- Workbench boot joins complete eager replay and startup: offline median
  411.795 ms; after npm 439.615 ms (upper bounds on I2 storage restore).
  Whole session-ready medians, separately: 1,400.420 / 1,609.615 ms.
- Whole cold open includes snapshot materialization/SCM: median 4,767.885 ms;
  I1 limits its durable-flush tail, not all first-open work.

Raw samples: `replica-public-scale-evidence.json`. Command:
`pnpm test:browser-unit tests/browser-unit/replica-public-scale.spec.ts` — PASS,
59.9 s including browser harness. Reference conditions: local Chromium,
fresh process; no OS page-cache eviction claim.
