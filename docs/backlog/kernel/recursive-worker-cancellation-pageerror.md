---
area: kernel
status: draft
title: Investigate creator pageerror during recursive nodemon cancellation
created: 2026-09-09
why: One production Ctrl-C replay logged a Playwright pageerror although the corresponding terminal reservation refusal is contained in deterministic Worker and Workbench probes.
sources: [ADR-0333, ADR-0347, docs/backlog/service-worker/reference/workbench-preview-prefix-app-proof.md]
code: [packages/kernel/src/spawn-worker.ts, packages/kernel/src/process-manager.ts, packages/workbench/src/glue/run-foreground-child.ts]
---

## Question

Which actual realm/default-error path emitted the captured Playwright
`process.reserve: ppid 2 is outside caller 2's subtree` during production
Express+SQLite nodemon stop? The terminal diagnostic alone is an expected loud
refusal: the supervisor tries to fork after ancestor admission was fenced.
A starting log precedes fork and does not prove a new Worker ran.

User action: launch Express+SQLite, edit/recover/rapid-edit source, queue another
write from Shell, switch Run terminal, Ctrl-C. Original production test failed
its HTTP-based output-count criterion twice; only the isolated log captured
this separate pageerror. That criterion has independent native counterevidence
and a separately reviewed completion/output-marker correction. Correcting the
criterion does not explain or waive the pageerror.

Repro command: `RIFTY_PLAYGROUND_PORT=5484 pnpm exec playwright test --config
playwright.prod.config.ts --project chromium --grep 'Fullstack demo'` at
be8254b28683778925bdfd26a13b52df7446e4c0. Source lifecycle/test files were
byte-identical to accepted I6; no baseline production replay established this
as pre-existing. I5 may change timing; causation remains unknown.

The bounded diagnosis traced real supervisor/descendant exit and close callbacks,
real CJS child_process fork and .bin execution, plus actual queued ErrorEvent
delivery after physical termination. Creator preventDefault remained effective;
no pageerror or residual process reproduced. Retaining the existing error
listener already covers the proposed late-event race. No speculative guard,
output suppression or new process state is justified.

Owner: kernel Worker error/termination boundary. Trigger: reproduce the actual
creator pageerror with realm/error-event/physical-exit correlation. Preserve
ancestor admission fencing, descendant close settlement and admitted output.
Current uncertainty is recorded outside the I5 prefix capability; independent
review must revisit that disposition if a delivered-behavior violation emerges.

Dedup: queued-process-kill-cancellation is same-realm queued admission, explicitly
not this recursive Worker path. Kernel/distribution backlog, traps and declined
concepts contain no matching captured creator-error question. Evidence and
commands remain in the discovering PR's reference record.
