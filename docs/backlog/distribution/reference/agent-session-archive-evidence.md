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
