---
area: playground
status: draft
title: Open readable saved projects without certifying their install
created: 2026-06-12
why: absent or incompatible install trust currently blocks access to readable saved files and the terminal
user_story: As a developer reopening a saved Vite project after an interrupted npm install, I want my files and terminal to open without automatic installation, with dependency errors raised by the commands that actually use them.
epic: fault-honest-opfs-persistence
sources: [docs/adr/playground/0307-install-trust-is-an-install-protocol-commit-not-tree-surveillance.md, docs/adr/distribution/0394-apply-dependency-snapshots-through-catalog-transactions-and-saved-state-policy.md, docs/backlog/playground/reference/project-open-ide-boundaries-refine.md]
code: [packages/workbench/src/workers/package-acquisition-authority.ts, packages/workbench/src/workers/playground-project-authority.ts]
---

## Context

Saved snapshot admission calls `#trustedProvenance` and rejects the whole open
when it returns null. Manifest edits may retain live `owner-runtime` readiness,
then fail this check after reload. This is a source finding, not an executed
browser crash reproduction. The recorded native Node probe runs local source
despite a missing declared package and malformed lock; the missing `require`
fails at use. Full interrupted-install/browser proof remains for pickup.

## User scenario

Save an already working, snapshot-created Vite project. Run `npm install lodash`,
close the tab after install starts changing the tree but before completion, then
reopen the same project. Preserved sources and terminal remain accessible; no
implicit install or source snapshot restore. Commands execute against the saved
files; missing dependencies fail when used. The user may explicitly rerun
`npm install`. A pending/missing claim alone cannot block open or all Node commands.

## Boundaries

- Existing saved state is mutable, not a copy to revalidate against its initializer.
- Validate a supplied snapshot while applying it; retain its existing write/commit
  guarantees. Recover interrupted own catalog transactions before publishing a tree.
- Unreadable OPFS or unrecoverable own metadata remains a storage failure; this
  direction does not add partial storage recovery or certify torn writes as complete.
- Browser adapter incompatibility fails the capability that needs it. Never invent
  shadow bindings, promise unsupported execution, or block file access on that basis.
- Generic VFS, npm and runtime must not acquire IDE Scratch-dirty policy; companion
  ownership is captured separately in `scratch-dirty-ide-ownership.md`.

## Decisions

- 2026-09-10 — pickup: ADR-0415, existing package FIFO/reservation retained; no saved-open stamp promotion or automatic acquisition.

- 2026-09-10 — user: «да, ок, ровно поведение node», answering the exact Vite → interrupted `npm install lodash` → reopen files/terminal without auto-install scenario recorded in `reference/project-open-ide-boundaries-refine.md`.
- 2026-09-10 — reframe this existing draft: tree surveillance/automatic healing is not the requested outcome; retain the filename for incoming references.
- 2026-09-10 — before implementation, supersede the conflicting saved-open clause of ADR-0394 and review ADR-0261/0307/0309 admission clauses via DEC-2; this draft does not itself repeal those ADRs.
- 2026-09-10 — preserve baseline dirty meanings and storage recovery; no new user policy inferred from the ownership change.

## Challenge

challenge: 2026-09-10 — clear; original selected scenario and independent DEC-2 review retained in ADR-0415.

2026-09-10 — fresh read-only `/root/review_open_boundary`:

> Направление обосновано; две оговорки: child runtime всё ещё зависит от install trust, а recovery собственных транзакций нужен при mount.

Full evidence and dispositions: `reference/project-open-ide-boundaries-refine.md`.
Removing only the saved-open guard would move the failure into child admission.
Runtime reconstruction, real browser/Node proof and minimal mechanism selection
remain agent-owned pickup work; no new coordinator is prescribed.

## Pickup notes

Fold in directly related stale comments/ADR pointers while changing the open
boundary. The `installStampSatisfied*` helpers have no external production
callers in the 2026-09-10 scan; inspect before retirement. Async `readInstallStamp`
is LIVE (`no-coi-toolchain-worker.ts:115`, `install-stamp-reading.ts:93`) and is
not a dead-export candidate. No-COI installer trust remains an installer-boundary
consumer; the old single-instance inventory must not justify deleting it.
Full report disposition: `reference/fs-dirty-stamp-findings-disposition.md`.

## Reference contract

Node v24.16.0: the executed local-source/missing-require probe in
`reference/project-open-ide-boundaries-refine.md`. Node has no project-wide
install-certification precondition. Snapshot validation is Rifty's own baseline.

## Acceptance

1. Reopen snapshot-created Scratch and named saved projects with absent, pending or incompatible claims, changed manifests or malformed/missing locks: preserved files and terminal remain usable without implicit acquisition or writes to the saved tree. → scenario
2. Local Node scripts run independently of install certification. Missing packages fail at use; only validated existing shadow data grants runtime bindings; unavailable adapters fail at their consumer, not unrelated Node entry. → scenario
3. After an interrupted real npm installation has begun changing saved state, a fresh owner opens it; explicit npm install may complete and the installed package runs. → scenario
4. Own transaction recovery, snapshot apply/commit/rollback, unreadable-storage failure and Save rebind guarantees retain their existing baseline. → scenario

## Parity cases

1. Existing local source runs with a manifest naming an unavailable dependency and a malformed lock; missing require returns MODULE_NOT_FOUND. Native v24.16.0 artifact above; real Workbench browser terminal is the delivery carrier. → scenario

## Fault matrix

- torn-state × npm install/owner death | readable retained files and terminal; no false install proof or automatic healing | saved-project-access contract + browser interrupted install → scenario
- corrupt-input × manifest/lock/adapter | files remain accessible; dependency/adapter error at use | saved-project-access + entry-adapter-failure contract + browser commands → scenario
- quota-perm-fail × own snapshot/catalog transaction | existing failure and recovery preserve committed state | workbench-snapshot-apply-rollback and workbench-snapshot-application browser suites → scenario

## Out of scope

No-COI explicit toolchain activation policy (ADR-0392), partial recovery of
unreadable OPFS, performance profiling/optimization, new generic TrustedState.
Unsupported capabilities retain loud failures.
