---
area: net
status: active
title: node:sqlite Node-vs-rifty head-to-head parity case (sequenced to DatabaseSync shim)
created: 2026-06-08
why: Parity case was deferred to the shim task; confirm the now-landed sqlite cases satisfy ADR-0065's mandate
user_story: As a dev relying on `node:sqlite` behaving like real Node, I want the `kind:'sqlite'` parity cases to prove construct/exec/close, prepare/all/get/run/iterate, named params and bigint-overflow refusal all match, but today that coverage is unconfirmed — pending an M12 audit that the landed cases span the full mandated surface.
sources: [ADR-0065 Consequences]
---
## Context
ADR-0065 mandates a Node-`DatabaseSync`-vs-rifty-shim parity case. Q-303 (Option A) deferred it from the engine-init task (no `node:sqlite` specifier to diff yet) to the `DatabaseSync` shim task. That shim has since landed: the parity runner now has a `kind: 'sqlite'` mode and cases exist — `cases/sqlite/{construct-exec,prepare-all,run-get-iterate,read-bigint-overflow}.case.ts`. So the genuine residue is confirm-coverage, not net-new work.

## Options / Next
Next: at M12 DoD confirm the existing `kind:'sqlite'` cases cover the surface ADR-0065 requires (construct/exec/close, prepare/all/get/run/iterate, named params, bigint-overflow refusal, boot sequence) and mark this item Promoted/closed. If a surface member is found uncovered, add the missing `.case.ts`.

## Reversibility
REVERSIBLE — purely a test-sequencing decision, no public API change. The backlog item is this file; confirm→close.
