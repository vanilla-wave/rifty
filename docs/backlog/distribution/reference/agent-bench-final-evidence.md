# Agent benchmark final evidence

Authority: goal I8 + scenario4, ADR0434; slice BASE accepted UI0bcf3340b.
Live source253911975 was clean.42 actual runs, no budget/provider failures.
Full original matrix/trace/file trees: tools/agent-bench/reports/summaries/2026-09-13-gpt-5.6-sol.
Raw outcomes and later native replays are separate observations; no paid rerun or model-artifact repair.

## Native isolation

Fault: provenance-lie at native project dependency boundary. A report-root project
under the checkout resolves repository packages through Node parent lookup.
Direct Node oracle records checkout resolution versus a genuinely temporary project.
Actual Pi bash RED also printed LEAKED_CHECKOUT_PACKAGE pointing at packages/agent.
Moving only the project to mkdtemp remained RED under the package-manager test launcher:
actual child cwd was the temporary directory and executable was real Node24.16.0.
Native children now also omit inherited NODE_PATH, without inspecting its value.
The same real Pi/Node test becomes GREEN. Test explicitly injects a checkout
NODE_PATH, so the carrier does not depend on the driver's launcher configuration.
Sibling sweep: local-reference is the only native project owner; packed consumer
already uses an external mkdtemp. npm install/dev/Pi use the same native environment.
Live projects already lived outside the checkout. Recorded native tool commands
used their own installed dependencies; no checkout package access was observed.

## Common form judge

Fault: frozen-assumption at DOM outcome observation. Original judge required an
ARIA button and HTMLInputElement, then read title existence immediately after a
navigation. User-visible navigation links and required textarea satisfy the same
accepted creation workflow. Fresh independent native probes executed retained
form1–3:25 initial,25 after rejected empty title,26 after valid title, visible
required feedback. Original judges rejected the link before observing that behavior.
A real required textarea similarly gave browser validationMessage,25→25→26,
while the original judge claimed no required feedback.
After broadening those two element predicates, independent native replay exposed
an immediate title.count race on form2/3. Wait for visible form/new card before
reading outcomes; missing results still fail with the actual selector timeout.
Seven native positive controls include a real routed Link and required textarea;
common smoke retains the planted defects and identical evidence across all lanes.

## Other required repairs and baseline

- npm tar root/type handling and materialized installation identity: original
  tarball/native pacote oracle, regressions, mutants, all snapshots re-baked.
  See agent-bench-types-extraction-evidence.md and agent-bench-baseline-results.md.
- git status --short: actual native Git oracle, shared existing formatter;
  existing untracked-directory collapse caveat retained. See agent-bench-git-short-native.json.
- Resident CI test callbacks start after actual selected-entry VFS marker, per port;
  delayed RPC RED/GREEN, ownership assertions unchanged. See agent-bench-ci-resident-evidence.md.
- Frozen core prompt unchanged; no-auth/key privacy/limits/torn-state/actual
  browser judging proven by external HTTP observer and real hosts. Default CLI
  context/tools and semver registry resolution differences remain explicit.

## URL judge settlement

Fault: observable-order/frozen-assumption at DOM observation. Original ZIP shows
closed/Mara selects finishing within3.4ms. Independent exact React19.3/Router7.18.3
native replay reproduced lost status on both retained source and the original
functioning positive control, after entering Issues at CPU×6. Both passed with
rendered-list settlement at that same CPU rate. No rifty-only cause inferred.
The common judge now opens a committed Issues document and waits for actual
expected rendered IDs before the next filter action; all old URL/reload assertions
remain. The positive control begins at an existing filtered Issues route under
CPU×6. Actual COI replay writes retained src files via the authorized seed hook,
uses ordinary Reload preview, awaits the new frame and judges it. Every src byte
is then compared with the saved model artifact: unchanged; common judge PASS.

Original38/42 and audited42/42 are explicitly separate in the diagnostic.
All42 model measurements remain; four rows retain task-bad and their exact reason.
The bundle contains actual traces/before/after; rechecks retain reviewer native
version facts and source/judge hashes. No model call was added by artifact replay.

## Delivery validation

Product f5ff8b8484af6575d5761afd94c75f98cfda2da1, clean: pr:check25/25,
including unit/conformance188s and parity60.5s. Benchmark source34292:
full deterministic12/12 (10.7m), including14 actual task/lane smoke runs;
seven native positive controls PASS. f5ff delta formats three JSON artifacts
(deep-equal values), uses spawn's NODE_PATH:undefined instead of delete for lint,
and removes the regression's own temporary report; isolated Pi/Node regression
reverified PASS11.2s. No gate exception was introduced. Raw command/output records:
`agent-bench-validation.json.gz`. CI's earlier lint failure is retained history;
only the final PR head's checks establish delivery.
