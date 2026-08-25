---
area: perf
subsystem: toolchain-build
status: ready
title: Child fs perf canonical scenario, raw-output verifier, CLI and atomic artifact substrate
created: 2026-08-26
epic: child-fs-rpc-hot-path
why: the two physical benchmark lanes need one exact scenario/result authority before either topology can report comparable numbers
user_story: As the child-fs goal's measurement author, I want canonical guest bytes and one strict artifact verifier, so a lane cannot claim parity with invented digests, self-attested booleans, partial samples, or rounded projections.
sources: [split predecessor perf/child-fs-perf-lane attempts 1-2 @ fb02b2c2f, spike 1261339acc1d1eb3f864a9a48ed50bf067fe0f02]
code: [tools/perf/child-fs/scenario.mjs, tools/perf/src/child-fs-artifact.mjs, tools/perf/src/child-fs-runner.mjs]
---

## User scenario

Both future browser lanes import one canonical scenario containing the exact
Vite 2180-module guest tree, Express cold-listen source, and pinned dependencies.
They hand raw command output plus emitted asset bytes to one verifier. The CLI
substrate rejects invalid invocation/port ownership and publishes a validated
artifact with an atomic sibling-temp rename.

## Acceptance

- One canonical export owns exact guest files and dependency versions. Its
  scenario/dependency SHA-256 digests are derived from canonical bytes; callers
  cannot supply or override either digest.
- Vite verification derives, from raw output and emitted JS, exactly one
  self-time, exit 0, exactly 2180 transformed modules, and exactly one fresh run
  marker. Express verification derives exactly one ready duration and one close
  proof from raw output, requires exit 0, and pins source whose clock starts
  before `require('express')`.
- Artifact build/validation accepts exactly N ordinals for each named topology,
  preserves every raw sample and environment field byte-for-byte, exposes no
  pass/fail multiplier or rounded timing, and rejects every malformed/extra/
  partial identity or result.
- CLI parsing requires one positive integer `--runs`, non-empty `--out`, and a
  valid strict port before launch. Port probing resolves when free and rejects
  an occupied listener.
- Publication uses a sibling temp plus atomic rename. Default real-FS and
  injected-boundary tests prove exact final bytes; write/rename failure is loud,
  cleans the temp, and never writes a partial success path.

## Parity cases

- `vite-raw`: parse one real Vite `2180 modules transformed` + `built in Xs`
  pair and one emitted marker; reject nonzero exit, wrong/duplicate/missing
  count/time/marker, and any caller-supplied derived field.
- `express-raw`: parse one canonical `RIFTY_EXPRESS_READY <marker> <ms>` and
  `RIFTY_EXPRESS_CLOSED <marker>` pair; reject nonzero exit, non-positive time,
  duplicate/missing/mismatched markers, or source/digest drift.
- `artifact-identity`: canonical digests, lane topology, ordinal, git SHA,
  Chromium version, owner-load mode, and raw outputs survive build→validate
  exactly; extra multiplier/summary keys and N−1/duplicate ordinals fail.

## Fault matrix

| Boundary / axis | Required outcome | RED target |
|---|---|---|
| guest/raw result `corrupt-input` / `lossy-aggregate` | derive from canonical/raw carriers; reject invented digest/result, malformed/extra/partial rows | verifier corruption table through build and validate |
| CLI `corrupt-input` | invalid/missing/duplicate args reject before any launch callback | argument table + launch spy |
| strict port `concurrent-same-key` | free resolves; occupied rejects before launch | real loopback listeners |
| artifact storage `quota-perm-fail` / `torn-state` | exact temp→rename publication; failure cleans temp and propagates | real default I/O + injected write/rename failure |

## Out of scope

- Starting Chromium, a dev server, product child, or in-realm Worker.
- Registry/page/Worker timeouts and death handling; owned by
  `perf/child-fs-perf-orchestrator`.
- Numeric performance thresholds or multiplier fields.

## Decisions

- 2026-08-26 — split predecessor `perf/child-fs-perf-lane` after Contract+RED
  attempts 1–2; this smallest substrate owns no browser lifecycle.
- 2026-08-26 — digests and parsed timing/result fields are derived authorities,
  never caller assertions; artifact schema is exact (unknown keys reject).
- 2026-08-26 — expected RED command `pnpm vitest run
  tools/perf/src/child-fs-artifact.test.ts tools/perf/src/child-fs-runner.test.ts`
  on Vitest 2.1.9; 9 tests target the absent substrate modules.
