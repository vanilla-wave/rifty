# Independent core Final+GREEN

Reviewer: `/root/core_final_review` (fresh context, read-only tracked tree).
BASE `acf594da9`; reviewed clean HEAD `523628b0cc4828e4ae802445e683f84a7f0359cc`.
Unit: `docs/backlog/distribution/ai-ide-pi-agent-harness.md`.
Authority: accepted goal/map, raw refine/FIT evidence, ADR-0424, Contract+RED
`3807502aca22fef2407af19e423941f80bdc5f40`. No stronger criterion added.

## Independently executed

- `pnpm test:browser-unit tests/browser-unit/agent-core.spec.ts tests/browser-unit/agent-core-snapshot.spec.ts`
  — 17/17 PASS, 17.1s. `/tmp/pr333-core-independent-browser.log`.
  Initial sandbox launch failed `listen EPERM ::1:5299` before tests; authorized
  loopback/Chromium rerun passed. No product failure or test retry hidden.
- `pnpm exec vitest run packages/agent/src/apply-patch.test.ts`
  — 7/7 PASS. `/tmp/pr333-core-independent-patch.log`.
- Copied the committed `ai-agent-pi-oracle.mjs` into a fresh temporary directory;
  ran its unmodified `runAll` against real Node files and exact installed Pi
  core/ai 0.85.1. Node v24.16.0, all seven cases PASS.
  `/tmp/pr333-core-independent-oracle.log`; complete result/effects:
  `/tmp/pr333-core-final-oracle-11cCfM/result.json`.
- Inspected retained packed install at
  `/var/folders/db/686y1tsx0cj84rn_2jmrf9680000gn/T/rifty-workbench-packed-consumer-16zNp3`.
  Independent Node check read lockfile + tarballs: all 178 HTTP resolutions use
  loopback and their exact SHA-512 appears in the local tarball set; no links.
  Smithy HTTP handler 4.7.3 at root, 4.12.1 under credential-provider-http and
  nested-clients. Agent exports `dist/index.js`/`dist/index.d.ts`, no shipped
  `src`, no bundler alias in consumer Vite config.

## Evidence reuse and changed criteria

Read the complete changed implementation, public API, fixtures and supporting
configuration against BASE; retained goal children were checked as goal work.

Raw full gate `/tmp/pr333-core-delivery-check.log`: 25/25 PASS, test:run 188.7s,
parity 61.3s. Full packed `/tmp/pr333-packed-core3.log`: PASS, 16 first-party +
177 external tarballs, strict TypeScript/build and complete Chromium journey.
Packed run predates the narrow result-classification/Stop/BOM/path repairs.
Those changes introduce no new package dependency, export or alias requirement;
current-head browser/unit proofs cover their semantics. Reused packed proof
therefore supports the unchanged install/build/HMR boundary, not an assertion
that the final tarballs were rerun in that earlier process.

Native npm now resolves the actual multiple-version external graph through
loopback packuments of the captured packages. The harness validates every HTTP
lock entry's exact served version/integrity. Runtime fixed-snapshot proof still
blocks external acquisition and asserts zero registry/Eddy requests. No package
manifest changed to flatten dependency versions.

PR-4 HMR changes inspected against the actual Node oracle source and
`/tmp/pr333-vite-oracle/result.json`: Vite 7.3.6 failed build code 1, syntax
repair replaces document, subsequent valid edit preserves marker. Current
source and packed scenarios assert a separate valid-write HMR transition.
The fixture's optional HMR module guard addresses Vite's invalid-module callback;
existing no-browser-error assertions remain. No criterion weakened to pass a
rifty defect.

The external proxy patch changes V2 provider declarations so the existing SDK
adapter handles native finish/usage; inspected retained patch and prior separate
independent review evidence. No new paid provider request needed for this core
checkpoint.

Adversarial malformed trailing diff hypothesis was executed with pure patch
planner and actual Git 2.50.1. Both accept the same first hunk and ignore that
trailer; no defect finding. `/tmp/pr333-core-review-patch-probe.log`.

## Verdict

PASS, 19/19 coverage rows, zero findings, no unit residuals. All four original
Contract+RED concerns have discriminating current carriers: exact edit/patch
errors and returned search contents; actual HMR document preservation; supplied
key redaction/consumer cap/output trace; differential ProjectTerminal text/exit.
Goal continues: UI/live endpoint acceptance, no-COI adapter/resident exit/full
cycle/replacement proof, benchmark. No tracked files modified by review.
