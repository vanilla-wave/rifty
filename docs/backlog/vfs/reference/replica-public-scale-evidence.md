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

## Final implementation and complete npm byte oracle

`replica-public-scale-final-evidence.json`: same three-profile public sequence
on the storage-diagnosis implementation. Additional manifest lists all **5,418**
original archive files by path/size/SHA-256. The unchanged verifier runs on native
Node and rifty after npm and after offline reopen; every byte hash matches.
The verifier manifest is ordinary additional source, persisted with the project.

Final medians: awaited first-open flushes 253.880 ms; complete replay plus owner
boot 421.035 ms offline / 481.070 ms after npm. Whole session-ready: 1,559.075 /
1,824.835 ms; whole cold open 5,275.835 ms. Every npm run still changes 5,420
ordinary node_modules paths. No registry/snapshot requests on offline starts.
Native root remains a single replica. Final carrier PASS, about one minute.
