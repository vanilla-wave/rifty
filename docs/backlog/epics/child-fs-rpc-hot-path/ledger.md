# Child fs sync-RPC hot path ledger

- 2026-08-26 — perf/child-fs-perf-lane band 8–12 expected REDs
- 2026-08-26 — perf/child-fs-perf-lane Contract+RED attempt 1 BLOCKER @
  5e025cbc8: missing committed REDs; unpinned/non-closing spike; robust CLI and
  atomic-publication fault rows absent — re-cut in place
- 2026-08-26 — perf/child-fs-perf-lane Contract+RED attempt 2 BLOCKER @
  fb02b2c2f: helper REDs cannot prove physical lanes/orchestration; second
  consecutive blocker → split in place
- 2026-08-26 — split perf/child-fs-perf-lane into artifact-core → product-lane
  + in-realm-lane → orchestrator; original remains draft lineage until absorbed
- 2026-08-26 — perf/child-fs-perf-artifact-core band 8–12 expected REDs
- 2026-08-26 — perf/child-fs-perf-artifact-core Contract+RED attempt 3
  (split-unit attempt 1) BLOCKER @ 878e87a95: five porous verifier/CLI/atomic
  replacement mutants — RED re-cut in place
- 2026-08-26 — perf/child-fs-perf-artifact-core verify BLOCKER @ f675ff5d9:
  real Vite oracle + five remaining deep/port mutants — RED re-cut in place
- 2026-08-26 — host Vite 7.3.6 canonical-tree probe = 2195 modules/908 ms;
  goal's 2180 count belongs to the physical Rifty lane contracts, not raw parser
- 2026-08-26 — perf/child-fs-perf-artifact-core verify 2 BLOCKER @ 0c0515cad:
  alternate-positive, negative numeric and N+1 RED rows missing — extended
- 2026-08-26 — perf/child-fs-perf-artifact-core final verify BLOCKER @
  e14c22b72: 3-decimal timing-rounding mutant survived — precision RED added
- 2026-08-26 — perf/child-fs-perf-artifact-core pass verify BLOCKER @
  c1769da54: build-side `speedupX` extra-key mutant survived — symmetric RED
- 2026-08-26 — ready-verdict perf/child-fs-perf-artifact-core: Contract+RED @
  f446f8abf — PASS, unit residuals empty
- 2026-08-26 — perf/child-fs-perf-artifact-core Final+GREEN BLOCKER @
  7f03b918c: 3 verifier gaps + terminal self-attestation + duplicate port/write
  mechanisms — fixed in one batch, shared owner `tools/perf/src/runner-io.mjs`
- 2026-08-26 — perf/child-fs-perf-artifact-core Final+GREEN verify BLOCKER @
  44a550f43: `localhost` IPv6 occupied port escaped IPv4-only guard — fixed
- 2026-08-26 — perf/child-fs-perf-artifact-core Final+GREEN PASS @ deb9e6eb5;
  `pnpm pr:check` 24/24, unit residuals empty
- 2026-08-26 — learned canonical host Vite 7.3.6 graph = 2195 modules while
  physical Rifty spike = 2180; raw parser stays generic, both lane contracts own
  the Rifty-specific count; full carrier: `tools/perf/child-fs/`
- 2026-08-26 — learned all perf runners now share strict localhost admission
  and atomic artifact publication; owner: `tools/perf/src/runner-io.mjs`
- 2026-08-26 — re-chart after perf/child-fs-perf-artifact-core: 0 graduated /
  1 invalidated (completed item deleted); product + in-realm lanes unblocked
- 2026-08-26 — perf/child-fs-perf-product-lane band 2–4 expected REDs
- 2026-08-26 — perf/child-fs-perf-product-lane Contract+RED BLOCKER @
  1730d0573: opaque fixture self-attested product path/output/cleanup; re-cut to
  a real sealed-Workbench host seam + shared raw-sample verifier
- 2026-08-26 — product pickup found Express CLOSED-before-READY accepted by the
  shared parser; fixed at artifact authority with direct raw-sample entry
- 2026-08-26 — perf/child-fs-perf-product-lane Contract+RED verify BLOCKER @
  20ca80cbc: projected trace hid asset/Express order + duplicate close — fixed
- 2026-08-26 — perf/child-fs-perf-product-lane Contract+RED final verify
  BLOCKER @ dd26201f3: early emitted-read hidden by max projection — fixed
- 2026-08-26 — ready-verdict perf/child-fs-perf-product-lane: Contract+RED @
  e633605b0 — PASS, unit residuals empty
- 2026-08-26 — perf/child-fs-perf-product-lane Final+GREEN PASS @ 0f2d2224d;
  artifact unit 7/7, real COI product/fault 2/2, typecheck + architecture gates,
  unit residuals empty
- 2026-08-26 — learned raw Vite terminal proof uses CSI `1G` line restarts;
  artifact parsing interprets terminal display boundaries while retaining exact
  raw bytes; carrier `tools/perf/src/child-fs-artifact.test.ts`
- 2026-08-26 — re-chart after perf/child-fs-perf-product-lane: 0 graduated /
  1 invalidated (completed item deleted); in-realm lane compiled ready,
  orchestrator still blocked on it
- 2026-08-26 — perf/child-fs-perf-in-realm-lane band 2–4 expected REDs
- 2026-08-26 — perf/child-fs-perf-in-realm-lane Contract+RED BLOCKER @
  b5cbba7e7: porous tail alternation/reply schemas/error + Worker provenance;
  re-cut in place
- 2026-08-26 — perf/child-fs-perf-in-realm-lane Contract+RED verify BLOCKER @
  c4e57fef9: late reply schema/path mutants + projected real registry envelope;
  fixed by full phase sweep and independent error-message recording
- 2026-08-26 — perf/child-fs-perf-in-realm-lane Contract+RED final verify
  BLOCKER @ 0c73c30b5: wrong structured reply values survived exact-key checks;
  backend/seed/write/entries value sweep added
- 2026-08-26 — perf/child-fs-perf-in-realm-lane Contract+RED verify BLOCKER @
  9079ed68b: wrong-kind fault confounded by shape + hardcoded success ordinal;
  isolated discriminant fault and valid ordinal-3 control added
- 2026-08-26 — perf/child-fs-perf-in-realm-lane Contract+RED final verify
  BLOCKER @ 1bf2ff23f: Express wrong discriminant survived boot/Vite examples;
  same-shape wrong-kind sweep extended across every reply type
- 2026-08-26 — perf/child-fs-perf-in-realm-lane Contract+RED verify BLOCKER @
  581e980fd: duplicate startup ready escaped command-loop duplicate carriers;
  duplicate-ready rejects before the first post
- 2026-08-26 — perf/child-fs-perf-in-realm-lane Contract+RED verify BLOCKER @
  6e39e3fe7: post-ready `messageerror` could hang an in-flight phase; both
  readiness and command-loop messageerror carriers now required
- 2026-08-26 — perf/child-fs-perf-in-realm-lane Contract+RED verify BLOCKER @
  00f768d02: valid + foreign entries survived lossy filtering; mixed entry set
  now rejects before asset reads
- 2026-08-26 — perf/child-fs-perf-in-realm-lane Contract+RED verify BLOCKER @
  730e19ff6: Worker `error` covered only module-load readiness; controlled
  pre-ready + in-flight error carriers added beside messageerror
- 2026-08-26 — perf/child-fs-perf-in-realm-lane Contract+RED verify BLOCKER @
  8084fe65c: terminal duplicate Express could escape during termination;
  synchronous terminal duplicate now rejects before completion
- 2026-08-26 — ready-verdict perf/child-fs-perf-in-realm-lane: Contract+RED @
  9d6afb8ce — PASS, unit residuals empty
- 2026-08-26 — perf/child-fs-perf-in-realm-lane Final+GREEN BLOCKER @
  5b2c95c6c: terminal Worker task could arrive after listener disposal; explicit
  `finish→finished` self-close proof now gates settlement
- 2026-08-26 — perf/child-fs-perf-in-realm-lane Final+GREEN PASS @ b9a073480;
  real/fault browser 2/2, lint + typecheck + architecture gates, unit residuals
  empty
- 2026-08-26 — learned one Worker sample needs an explicit closure proof:
  `finish→finished`, then Worker `self.close()`, then host terminate; this keeps
  terminal errors/duplicates observable without a timing grace period
- 2026-08-26 — re-chart after perf/child-fs-perf-in-realm-lane: 0 graduated /
  1 invalidated (completed item deleted); orchestrator compiled ready and I3 is
  its only remaining measurement dependency
- 2026-08-26 — perf/child-fs-perf-orchestrator band 2–4 expected REDs
- 2026-08-26 — perf/child-fs-perf-orchestrator Contract+RED BLOCKER @
  eabdd8a25: no real CLI carrier; delayed death/shutdown/projection and exact
  publication/provenance porous; re-cut in place
- 2026-08-26 — perf/child-fs-perf-orchestrator Contract+RED verify BLOCKER @
  4d3c53180: readiness hang, public admission bypass and cleanup-time page/
  server death survived; carriers added at exact entry/lifecycle seams
- 2026-08-26 — perf/child-fs-perf-orchestrator Contract+RED verify BLOCKER @
  07f5b9196: sample rounding/projection and baseline→ledger timing provenance
  survived; independent expected artifact + exact ledger line required
- 2026-08-26 — perf/child-fs-perf-orchestrator Contract+RED verify BLOCKER @
  77a961196: deadline could cover only first product sample; lane×ordinal timeout
  matrix now covers product/in-realm at ordinals 1 and 2
- 2026-08-26 — ready-verdict perf/child-fs-perf-orchestrator: Contract+RED @
  6bff21e2e — PASS, unit residuals empty
