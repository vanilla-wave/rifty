---
area: distribution
status: draft
title: Persistent WebKit OPFS support probe reports DataCloneError despite working SDK persistence
created: 2026-09-28
why: a host using the support report rejects non-COI persistent WebKit while actual SDK write and reopen pass
sources: [ADR-0469, docs/backlog/playground/reference/browser-floor-cross-engine-evidence.md]
code: [packages/workbench/src/support/check-sandbox-support.ts, packages/workbench/src/support/support-worker.ts, tests/no-coi/browser-capabilities.spec.ts]
---

## Context

Finding. WebKit 26.4, Playwright 1.60.0, persistent profile, real public
`checkSandboxSupport({ persistence: 'required' })`: non-COI `unsupported`,
`unmet: ['opfs']`; the check reports `DataCloneError: The object can not be
cloned.` Cleanup passes. Actual SDK persistent native flush, replica bytes
and exact-byte reload pass in the same fixture on this build.

The probe sends a native `FileSystemDirectoryHandle` from Window to Worker.
A direct native `worker.postMessage({ directory })` on this build reproduces
the same `DataCloneError`; Chromium/Firefox deliver the handle. Source
acquisition inside a Worker succeeds in the native probe. Do not infer a general WebKit
OPFS failure or widen browser floors from this result.

Reproducer: `pnpm exec playwright test --config playwright.no-coi.config.ts
--project=webkit browser-capabilities.spec.ts`. Full commands and evidence:
`docs/backlog/playground/reference/browser-floor-cross-engine-evidence.md`.
Owner: workbench support probe. Trigger: WebKit support-report fidelity work.
Deferred by the browser-support-floor user's record-only choice; not a goal
child. Dedup found no existing item for the persistent-context clone failure.

## Native Safari observation

2026-09-28, Safari26.6.2 on macOS, native WebDriver: same required-persistence
`opfs` DataCloneError; boot/install/build/flush/reload/exact-byte reopen/rebuild
pass. Source: docs/backlog/distribution/reference/browser-manual-safari-native.json.
The direct handle-transfer probe above remains WebKit evidence; no new Safari
root-cause isolation is claimed. Same owner/finding, no duplicate.
