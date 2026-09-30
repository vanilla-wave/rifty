# Archive implementation evidence

## PICKUP

Baseline: PR #364 documentation merged with current main at 25266b71a.
Pi 0.85.1: session.ts emits message_end, retry-start receipts and compaction-end
separately. compactionHistory projects original receipts; reset clears events.
Archive captures before that clearing, not exportTrace's projected transcript.

Storage inventory: public OpfsVfs.writeFile awaits createWritable/write/close;
readFile/readdir read native files. Workbench project deletion only owns project
containers. No existing shared conversation storage owner. ADR-0482 records
candidates and coordination inventory. No external Node semantics claimed.

RED command: `RIFTY_PLAYGROUND_PORT=5413 pnpm test:browser-unit tests/browser-unit/agent-archive.spec.ts`.
Output and revision recorded after run below. Test uses real MemoryVfs project
files and real OPFS archive, fake only external provider/network and native
permission boundary. Installed public SDK/Workbench proof follows in same unit.

RED result: 7 failed / 7, 2026-09-30, real Chromium. Behavioral failures:
no archive receipt/files; missing archive_search; permission failure incorrectly
yields done; corruption not read; compaction leaves no original archive;
cross-tab saves produce zero files; no native archive write to interrupt.
No import/typecheck failure. Full transient log: /tmp/rifty-archive-red.log.

## Core GREEN

- `RIFTY_PLAYGROUND_PORT=5413 pnpm test:browser-unit tests/browser-unit/agent-archive.spec.ts`: 10/10 PASS (7.5 s), including images/provenance, credentials exclusion, quota and native-close receipt order.
- `pnpm exec vitest run --project unit packages/agent/src`: 118/118 PASS, 11 files.
- `pnpm --filter @riftydev/agent typecheck`: PASS.
- Pi 0.85.1 dist/agent.js:139–145,417–418 awaits event listener promises. Session drains its archive chain there; synchronous retry receipt ingress shares the same chain. No tool-dispatch coordinator added.
- `pnpm pr:check`: 27/27 PASS. `test:run` initially failed two timer-effect assertions in `packages/workbench/src/workers/no-coi-project-command-exit.test.ts:64,80`, zero Vitest timeouts, host load 15.9/22.3/13.9. Its single automatic isolated rerun passed. Non-isolated failure remains unexplained; no reproducing defect or speculative source repair claimed. Full log: /tmp/rifty-archive-pr-check.log; initial report: /private/var/folders/db/686y1tsx0cj84rn_2jmrf9680000gn/T/rifty-pr-check-ZJGedp/test-run.json.

## Final review repair

Fresh reviewer archive_core_final found F1: archive_search searched serialized JSON,
so original quotes/newlines/backslashes could not match. Independent native Chromium
probe: /tmp/rifty-archive-final-probe.log. Accepted FIX; no scope change.
Main suite RED: `RIFTY_PLAYGROUND_PORT=5413 pnpm test:browser-unit tests/browser-unit/agent-archive.spec.ts -g 'discovery searches original'` → 1 failed, missing shop result.
Search now visits decoded strings at one boundary. Same full suite → 11/11 PASS
(8.7 s), including the unchanged RED assertion. No source test weakened.
- Post-F1 `pnpm pr:check`: 27/27 PASS. Initial `test:run` had 3 failures / 2 Vitest timeouts in installer-shadow-recipe-v2-acquisition-replay-authority.contract.test.ts and dep-snapshot.test.ts; both passed the single automatic isolated rerun (host load 41.4/45.4/34.6). No isolated reproduction or speculative repair. Log: /tmp/rifty-archive-pr-check-2.log.

## Installed-host discovery: managed project deletion

Packed run 2: SDK scripted + real gpt-6-luna recall PASS after delete/reload.
Workbench failed EPERM on its installed node_modules/.rifty-install-stamp.json.
Unit reproduction confirms workbench-project-store.deleteProject directly called
guarded authority.rmSync without the existing composition-only claim capability.
Baseline: public deleteProject, goal scenario3; no new product promise.

Class: sibling-drift / observable-order at owned in-process policy boundary.
Sweep: Playground catalog already uses removeManagedTree; package acquisition
clears claims before reset via its guard transitions; core deleteProject and
sibling discardStage used raw removal. Both now reuse that existing helper;
composition supplies its existing InstallStampClaimIo. Read-only project probing
needs no mutation capability and shares only the record reader. No lock or owner added.
Transport loss/duplication/reorder are excluded at this synchronous policy boundary;
quota/permission errors retain existing loud mutation/durability failure semantics.

RED: `pnpm exec vitest run --project unit packages/workbench/src/workers/workbench-project-store.test.ts`
→ new deletion case failed EPERM (5 existing passed), /tmp/rifty-project-delete-red.log.
GREEN: project-store, store-layout, first-materialization suites → 33/33 PASS,
/tmp/rifty-project-delete-green.log. Guard and orphan-stage follow-up recorded below.
- Claim-policy/store suites: 28/28 PASS. Reverting both cleanup calls to raw rmSync kills deletion and orphan-stage regressions (2 failed / 5 passed); code restored in finally. Workbench typecheck PASS. Logs: /tmp/rifty-project-delete-guards.log, /tmp/rifty-project-delete-mutant.log.

## Installed public acceptance GREEN

`node tests/integration/workbench-packed-consumer.mjs --keep --archive-model-config tools/agent-bench/configs/gpt-6-luna.json`
→ PASS: 16 first-party + 177 external tarballs; installed TypeScript/build;
fresh Chromium 148.0.7778.96. Full existing packed journey remains green.
Log: /tmp/rifty-archive-packed-3.log. Production source at 17c758e5c;
0844f9a53 only updates the separate legacy browser fixture's capability argument.

Both SDK and core public Workbench: save original messages/tool write, remove source
project, reload host, new blog discovers/reads source archive. Existing public
catalog rename + project export/import + delete preserve exact archive file bytes.
The default mandatory packed CI lane always executes these deterministic proofs;
only the external model endpoint is optional in routine CI.

Live gpt-6-luna, user-provided codex-proxy.mjs on configured port10539: both hosts
recalled a fresh unpredictable auth phrase after reload, with archive_search then
archive_read; no transcript/filename/phrase in recall input. Exact native traces:
agent-session-archive-live-sdk.json.gz, agent-session-archive-live-workbench.json.gz.
Each ended done with two successful archive tool results. The fake model was used
only for deterministic setup/tool orchestration, never storage or rifty packages.

Current archive + legacy-layout browser suites: 29/29 PASS (20.2 s),
/tmp/rifty-archive-browser-final.log. Generated compiler fingerprint gate PASS.
- `RIFTY_PLAYGROUND_PORT=5415 pnpm test:e2e:prod tests/e2e-prod/owner-boots-on-prod-build.spec.ts`: 1/1 PASS (32.7 s); production owner reaches live preview, no boot errors. /tmp/rifty-archive-prod.log.
- Final current-tree `pnpm pr:check`: 27/27 PASS, no isolated rerun needed (`test:run`195.5 s, parity118.0 s); /tmp/rifty-archive-pr-check-final.log. Earlier contention failures remain recorded above.

## Review repair: restored history duplication

Inline review of PR #364 at 538d11e23 found `archive.ts` seeding host-restored
`initialMessages` (ADR-0466) into a fresh UUID file: every restore re-archived the
same conversation, so `archive_search` returned one match per restore. Shipped
consumers pass no `initialMessages`; any embedder combining restore + archive hit it.
Class: `corrupt-input` (duplicate) at the owned in-process host→archive projection;
sibling `exportTrace.restoredMessageCount` already marks the same boundary, reused.
Fix: the envelope records `restoredMessageCount` and stores only this session's
messages; `archive_search` matches carry the count; reset returns to 0.

RED: `RIFTY_PLAYGROUND_PORT=5417 pnpm test:browser-unit tests/browser-unit/agent-archive.spec.ts -g 'restored from host history'`
→ 1 failed: two archive files contained the original text (expected 1). /tmp/rifty-archive-restore-red.log.
GREEN: same suite in full → 12/12 PASS (8.8 s), /tmp/rifty-archive-restore-green.log.
`pnpm --filter @riftydev/agent typecheck` PASS; `pnpm exec vitest run --project unit packages/agent/src` 118/118.
Independent Final+GREEN (fresh reviewer, read-only) at 312344012: pass; new test
pins the defect through both the file count and `archive_search` match count;
suite rerun 12/12. `pnpm pr:check`: 27/27 PASS (`test:run` 240.9 s, parity 126.0 s),
/tmp/rifty-archive-restore-pr-check.log.

## Review repair: discovery order, corrupt tolerance, image bytes

Same inline review: `archive_search` returned readdir (UUID) order, so recency was
random across pages; one corrupt/foreign/newer entry threw and hid every healthy
conversation with no in-agent repair path; base64 image data matched short queries.
Classes: `observable-order` (discovery order) and `false-fallback` (one unreadable
entry breaking the whole read-only path) at the archive directory scan; `lossy-aggregate`
for image bytes treated as text. Fix: scan collects `corrupt` entries and sorts matches
by `createdAt` desc; `archive_read` of a corrupt id still fails loudly; image `data`
is excluded from text search. Contract change recorded in ADR-0482/README: the old
"corrupt archive is reported as an error by discovery" case is replaced by the
per-entry listing case, not weakened.
`packages/agent/package.json`: workspace dependency order restored (nit).

RED: `RIFTY_PLAYGROUND_PORT=5417 pnpm test:browser-unit tests/browser-unit/agent-archive.spec.ts -g 'corrupt entry|newest conversations|never image bytes'`
→ 3 failed (search receipt failed on the corrupt file; order `[1000, 3000, 2000]`; image bytes matched). /tmp/rifty-archive-search-red.log.
GREEN: full suite → 14/14 PASS (9.4 s), /tmp/rifty-archive-search-green.log.
`pnpm --filter @riftydev/agent typecheck` PASS; agent unit 118/118; `biome check` clean.
- `pnpm pr:check` at a6b0255a9: 27/27 PASS; `test:run` had one vitest time-out in `packages/workbench/src/glue/dep-snapshot.test.ts` under load 36 (codex review + browser suite running concurrently), passed on its single isolated rerun; /tmp/rifty-archive-search-pr-check.log.

## Final+GREEN reception: F1 reader compatibility, F2 corrupt bound

Independent Final+GREEN (canonical runner, `agent-session-archive-repair-review-f1.json`,
reviewed a6b0255a9) returned BLOCKER F1: requiring `restoredMessageCount` at unchanged
`version: 1` rejected every healthy file written by the 538d11e23 writer as corrupt
(`corrupt-input`: schema misclassification; `read()` is shared, so search and read both
broke). Accepted: that writer copied restored history into the file, so a missing field
reads as 0 exactly. F2 (concern, also raised by a second fresh reviewer): `corrupt[]`
was unbounded when no healthy match existed; the outer 16 KiB receipt cap cut the JSON.
Fix: `corrupt` lists at most 10 entries plus `corruptCount`.
The first canonical run failed as a harness error: OpenAI strict output schema rejects
`tools/review/review-schema.json` (`required` must list every property); retried once
with a `/tmp` copy whose `required` arrays are complete (same model, `blockers.mjs`
unchanged). Recorded in `docs/process/traps.md`.

RED: `RIFTY_PLAYGROUND_PORT=5417 pnpm test:browser-unit tests/browser-unit/agent-archive.spec.ts -g 'before restoredMessageCount|bounds the corrupt list'`
→ 2 failed (legacy file listed as corrupt, 0 matches; corrupt list 12, no total). /tmp/rifty-archive-f1f2-red.log.
GREEN: full suite → 16/16 PASS (9.2 s), /tmp/rifty-archive-f1f2-green.log.
