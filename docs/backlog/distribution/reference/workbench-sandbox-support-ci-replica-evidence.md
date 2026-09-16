# PR #340: native fixture setup settlement

Date: 2026-09-16. Consumer-fit accepted at `36cbd0aea`; delivery HEAD `578553302`.
Additional observed gate failure; authority ADR-0425 decisions 3/7 and the existing
replica timeout test: reporting expiry retains the writer until actual settlement.
Preparation must produce a healthy native seed before exercising that timeout.

## Observation and reproduction

- Ready CI run `35030310412`, browser-unit job `104587138899`: 266 passed,
  1 skipped, 1 failed in 17.3 min. Only failure: replica-persistence.spec.ts:182,
  `Error: seed unclean`. All 29 sandbox-support tests passed. Other CI lanes and
  both deploy jobs passed. Raw `/tmp/pr340-consumer-ci-browser.log`.
- Isolated unchanged replica file on Chromium 148.0.7778.96:
  `RIFTY_PLAYGROUND_PORT=5393 pnpm exec playwright test --config
  playwright.browser-unit.config.ts tests/browser-unit/replica-persistence.spec.ts
  --workers=1`: 21/21 PASS, 39.2 s (`/tmp/pr340-replica-isolated.log`).
- Ranked hypotheses: 40 ms reporting budget reaches healthy seed; real OPFS
  refusal; cross-test interference. CI's generic error discards the failure detail.
- Controlled real-native discriminator: delay seed-only writable close by 80 ms;
  run same command with `--grep 'slow seed: true'`. One behavioral RED in 216 ms:
  exactly `seed unclean` (`/tmp/pr340-replica-slow-seed-red.log`). No source shim,
  storage fake, weakened assertion or unrelated workload. This proves the fixture
  defect; the original CI log alone cannot identify its native failure detail.

## Root and sweep

`replica-persistence-worker.ts` opens the hold fixture with a 40 ms report budget,
then `seed()` judges `flush()` before real native settlement. A healthy close may
legitimately outlast 40 ms. `fence()` already owns real settlement; setup must join
it before judging the persistent failure report. Native failures must still throw.
Boundary: test-owned storage setup → native OPFS; axis `frozen-assumption` (healthy
I/O assumed faster than fault-report deadline), not a product durability defect.

Sweep of replica browser fixtures:

- Persistence worker: one `seed()` owner, including hold; target hold flush/fence
  and physical writer/late-heal assertions stay unchanged.
- Native-read worker: same premature report check for seed and healthy concurrent
  writes; 63 setup commits also inspect HEAD after report-only waits. Same setup
  settlement helper owns these checks; held read/compaction reporting stays intact.
- Paired-VFS worker: setup awaits paired async mutations, which already join their
  real outcome; not the report-only pattern.
- Guard-deadline worker: short budget applies to deliberately held acquisition;
  no report-only seed. No new coordinator or product API required.

## Repair and proof

- One `settleOpfsSetup` helper joins the existing `fence()`, then rejects actual
  persistent failures with their details. Persistence seed and native-read setup
  use it. No new deadline, retry, production change or state owner.
- Original hold assertions retained verbatim; original native-read report/cleanup
  assertions retained. An 80 ms seed-close variant adds a real slow-storage guard.
- Both touched suites: `RIFTY_PLAYGROUND_PORT=5393 pnpm exec playwright test
  --config playwright.browser-unit.config.ts tests/browser-unit/replica-persistence.spec.ts
  tests/browser-unit/replica-native-read.spec.ts`: 31/31 PASS, 1.2 min;
  `/tmp/pr340-replica-setup-green.log`.
- Reverse check removes only `await fs.fence()` from the shared helper; slow-seed
  case fails on `OPFS setup unclean`, with `did not settle within 40ms` in the
  retained failure detail. `/tmp/pr340-replica-setup-revert.log`; source restored.
- The fixture defect is reproduced and repaired. The initial CI log discarded its
  native failure detail; attribution to its 40 ms threshold is consistent with the
  controlled discriminator, not an assertion that the discarded detail was read.
- Full `pnpm pr:check` after repair: 25/25 PASS; unit 209.7 s, parity 61.4 s,
  no failed-file reruns. `/tmp/pr340-replica-pr-check.log`. Only this evidence text
  changed after the tested fixture implementation at `6481b6270`.
- Independent Final+GREEN `/root/replica_fixture_review` at `28078a46e`: 12/12
  obligations, eight axes PASS, zero findings/residuals. Own native run 31/31
  PASS in 1.2 min (`/tmp/pr340-replica-independent-green.log`); JSON validator exit 0.
  Bound record: `workbench-sandbox-support-ci-replica-final-green.json`.
