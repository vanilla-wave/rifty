---
area: playground
status: draft
title: What does a user see when reopening a no-COI project whose last install failed with its stamp demoted?
created: 2026-11-23
why: A failed no-COI `toolchain.install` (e.g. `EBROKENLOCK` after a compact snapshot) leaves the project's install stamp demoted; the reopen/build behavior that follows is unprobed.
sources: [PR-388, docs/backlog/npm-client/shadow-pin-replay-bytes-cold-cache.md]
code:
  - packages/workbench/src/workers/no-coi-toolchain-owner.ts
  - packages/workbench/src/workers/no-coi-toolchain-install.ts
---

## Question

Code reading only (PR #388 cross-review, 2026-11-23), unprobed: `installManifest`
demotes the project stamp before the installer (`no-coi-toolchain-owner.ts:158`)
and promotes only after success (`:163`); any installer failure leaves it
demoted. Saved open (`openInstallation` → `prepareSavedToolchain`) reads no
stamp. What does the user then observe on `toolchain.open`, `runBin` and a
later install of that project — and is it the intended contract (ADR-0417/0415)?

Owner: playground (no-COI toolchain owner). Trigger: a probe or report of a
reopened project after a failed no-COI install.
