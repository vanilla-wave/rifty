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
  (workbench-owner-runtime.ts:343) — no prod reader; the restore-success line
  and `reportPromotion` explanatory prose (project-deps.ts:291 —
  persist-failure samples, «reload is unsafe until browser storage recovers»)
  reached zero consoles in every run.
- The active first-materialization boot branch
  (workbench-owner-runtime.ts:385 → `activateAndEnsure`) never reaches that
  legacy `restore()` code at all; only the bare `promotion-refused` reason
  surfaces via the authority observe hook → `console.warn`
  (owner-package-state.ts ~331-337) — the prose context is lost on every path.
- Snapshot unavailable (dev seam `rifty-e2e-snapshot-fault=status:404`, vite8
  cold deep-link): degrades to a real install and reaches LIVE, but the
  terminal viewport showed neither the recorded rejection reason nor an
  `npm install` transcript — possible ADR-0278:183 deviation («a rejected
  'snapshot' probe prints its recorded reason and performs the same visible
  real install»); verify scrollback before treating as a defect.

These are concrete instances of this item's contract gap; resolve the surface
question (console / terminal / health UI, which severities) in this item's
refine — never as a side contract elsewhere.

## Reversibility

New owner→page structured execution mechanism is a genuine cross-realm contract → ADR before `ready`. No kernel/public SDK surface is implied.
