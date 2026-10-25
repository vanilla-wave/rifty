---
area: playground
status: draft
title: Structured install and runtime diagnostics from the workspace owner
created: 2026-07-09
why: The owner already knows real run exit/error and npm progress/provenance, but the page receives incomplete outcomes or rendered terminal text, leaving the diagnostics UI no honest structured source.
user_story: As a developer whose install or command failed, I want the diagnostic linked to the exact command, cwd, run, stage, and real exit/error, but today that context is scattered across PTY state, history, stderr, and console.
epic: actionable-ide-diagnostics
blocked_by: [playground/diagnostics-hub]
sources: [M11, ADR-0146, ADR-0182, ADR-0188]
code: [packages/workbench/src/glue/pty-protocol.ts, packages/workbench/src/glue/pty-client.ts, packages/workbench/src/workers/pty-server.ts, packages/workbench/src/glue/npm-shell-command.ts, packages/npm-client/src/installer.ts, packages/workbench/src/workers/workbench-owner-runtime.ts, packages/workbench/src/glue/project-deps.ts]
---

## Context

Carry owner-authoritative execution outcomes into the diagnostics hub: app run id/rid, command, cwd, submit/finish wall time, real exit versus transport loss, structured error code/message, and install facts already exposed by `onPackage`, `onSubstitution`, and final `InstallResult.source`. Link records to the terminal command block; keep stdout/stderr byte-for-byte and do not parse it for state.

Do not invent PID/job identity, CPU time, npm percentages, Eddy provenance before final source, or exit codes for an owner disconnect. `PtyExit.error` currently dies in the page client; transport loss needs its own outcome rather than synthetic process failure.

## Evidence 2026-08-30 — restore/promotion diagnostics slice

Folded from the Contract+RED review of
`[[cold-restore-progress-visibility]]` (dedup: same owner-to-page diagnostics
boundary; own draft withdrawn). Measured (spikes 2026-08-29/30, chromium
148.0.7778.96, playwright 1.60.0):

- Owner package `log:` sink is `process.stdout.write`
  (workbench-owner-runtime.ts:327) — no prod reader; the restore-success line
  and `reportPromotion` explanatory prose (project-deps.ts:291 —
  persist-failure samples, «reload is unsafe until browser storage recovers»)
  reached zero consoles in every run.
- The active first-materialization boot branch
  (workbench-owner-runtime.ts:351/372 → `activateAndEnsure`) never reaches that
  legacy `restore()` code at all; only the bare `promotion-refused` reason
  surfaces via the authority observe hook → `console.warn`
  (owner-package-state.ts ~255) — the prose context is lost on every path.
- Snapshot unavailable re-probed 2026-10-26 (dev seam cookie with a malformed
  value → HTTP 400, vite8 cold deep-link): terminal 0 prints
  `snapshot-fetch-failed: … HTTP 400`, then `$ npm install` and its package
  transcript, then Vite — ADR-0278 rejected-probe visibility holds; no
  deviation. The 2026-08-30 «nothing in the viewport» reading was wrong.

These are concrete instances of this item's contract gap; resolve the surface
question (console / terminal / health UI, which severities) in this item's
refine — never as a side contract elsewhere.

## Reversibility

New owner→page structured execution mechanism is a genuine cross-realm contract → ADR before `ready`. No kernel/public SDK surface is implied.
