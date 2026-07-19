---
kind: epic
status: ready
title: Workbench stabilization — truthful outcomes across a live project session
created: 2026-07-19
value: Editing, Git, preview, persistence, diagnostics, and project switching converge to the exact live-session outcome instead of reporting failure after success, healthy after data loss, or closed while an old route survives.
user_story: As a developer using the Workbench for a real Node project, I want every save, Git action, preview, diagnostic, and project switch to have one truthful outcome, but today delayed terminals, persistence faults, conflicts, and failed teardown can leave the UI disagreeing with the owner.
items: [playground/owner-vfs-mutation-terminal-certainty, playground/session-tool-mutation-terminal-certainty, playground/preview-route-teardown-certainty, playground/workbench-persistence-health-propagation, playground/editor-conflict-recovery, runtime-js/plain-esm-inline-source-map-fidelity]
---

## Outcome

The Workbench has one fault-honest live-session contract. Once a mutation is admitted, a page timeout cannot turn a still-committable operation into a definitive failure; session-tool persistence failure cannot leave health at `healthy`; a preview route is not forgotten before its teardown is certain or allowed to admit a new session after failure; and an editor conflict retains both byte sequences until the user explicitly reloads, compares, or replaces. Errors from plain ESM configuration name the original source and line, not Rifty's generated module.

Project switching is an invariant of this epic, not a request to keep two projects alive. The full active `ProjectSession` — runtime, PTY, session tools, and preview routes — closes before the next session opens. A physical Workbench owner may be reused, but no live root is repointed and no second project becomes active during teardown. To the user, switching always stops the old environment and starts the new one.

This is the finite post-PR-153 audit of current `main`, not an umbrella for every runtime gap found while reviewing Workbench. Each child owns one confirmed fault class and must include a sibling sweep before becoming `ready`.

## User scenario

A developer opens the real Vite Starter, edits a file in Monaco, then changes the same file from the terminal. The editor retains both versions and offers Reload, Compare, and explicit Replace. A delayed owner receipt never produces “save failed” while the write can still land. They stage and commit with the session-tools response delayed past its current timeout; the UI eventually shows the one owner-proved result and a retry cannot duplicate the mutation. If OPFS quota fails after the in-memory Git change, Workbench health becomes degraded immediately and remains so until durability is proved.

They introduce an error in an ordinary ESM config with an inline source map; terminal and preview diagnostics point to the original config path and line. They then switch to the real Express Starter. The old runtime, PTY, tools, and every preview route settle and close before the Express session opens. A teardown failure is visible, repeated close returns the same failure, and the Express session remains blocked instead of opening over an uncertain route. No old Vite response is routed after a successful switch, and the new environment starts from its own root.

## Items

- `playground/owner-vfs-mutation-terminal-certainty` (draft) — preserve correlation until every admitted conditional VFS mutation has an owner-proved terminal outcome.
- `playground/session-tool-mutation-terminal-certainty` (draft) — make SCM and archive mutation results replayable after delayed or lost responses.
- `playground/preview-route-teardown-certainty` (draft) — retain the mounted route handle across failed teardown while existing lifecycle poisoning blocks the next session.
- `playground/workbench-persistence-health-propagation` (draft) — project session-tool SCM/archive persistence failures into current Workbench health.
- `playground/editor-conflict-recovery` (draft) — expose Reload, Compare, and explicit Replace without discarding either version.
- `runtime-js/plain-esm-inline-source-map-fidelity` (draft) — remap generic plain-ESM inline maps and prove the result through a real Workbench config failure.

## Scope boundaries

- `fault-honest-opfs-persistence` owns lower storage, crash/reload, and persisted-artifact truth. This epic owns the live Workbench outcome and health projected from that truth.
- `fault-honest-sw-preview` owns HTTP/WS broker settlement. This epic owns the page registry's possession and retirement of mounted route handles.
- `vite-knowledge-boundary` owns where Vite knowledge may exist. Vite and Express are acceptance consumers here; generic production behavior does not branch on either tool.
- `embeddable-dev-loop` owns extraction and distribution of public controllers. The four owner-VFS/session-tools/preview/health children here are prerequisites to `distribution/workbench-controllers` package seal; this epic does not add public surface merely to repair private lifecycle correctness.

The same audit confirmed three platform gaps, tracked separately as `runtime-js/esm-module-job-graph-parity`, `runtime-js/require-extensions-extensionless-resolution`, and `kernel/sync-rpc-primordial-integrity`. They enter this epic only after a concrete Workbench acceptance blocker is reproduced. PTY mutation/control ACK correlation, VFS close draining, ProjectSession/owner lifecycle teardown poisoning, and same-path editor write serialization are already present on current `main`; no duplicate children are created.
