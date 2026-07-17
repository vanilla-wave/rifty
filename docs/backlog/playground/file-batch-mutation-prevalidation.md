---
area: playground
status: draft
title: Prevalidate FileExplorer batch mutations before observable work
created: 2026-07-17
why: renameMany and writeFiles can flush editors or partially mutate the tree before rejecting a later invalid item
user_story: As a playground user, I want an invalid multi-file action to leave every editor and project file unchanged.
sources: [PR-136-recut]
code: [apps/playground/src/adapters/playground-project-view.ts]
---

## Context

`renameMany` and `writeFiles` call `beforeMutation` on raw paths, then normalize and
validate each item only while applying it. A batch whose first item is valid and
second path escapes the project root can therefore close/flush affected editors
and apply the first item before the second throws.

Fault classes: `observable-order` (validation follows editor preflight) and
`torn-state` (validation failure exposes a partially applied batch). Reproducer:
pass two entries with a valid first path and `../outside` as the second path, then
assert no preflight and no file operation occurred. The affected siblings are
`createPlaygroundFileMutations.renameMany` and `.writeFiles`; single-item
mutations are not implicated.
