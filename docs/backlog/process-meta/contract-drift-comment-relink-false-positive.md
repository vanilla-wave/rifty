---
area: process-meta
status: draft
title: contract-drift false positive on comment-only TODO relinks
created: 2026-07-26
why: a two-line `// TODO(backlog: …)` relink in .ts counts as production source beside a ready-flip, forcing a separate two-line PR (real-node-server-dev-loop session, PR #152)
sources: [codex session 019f9b94 2026-07-26, tools/checks/contract-drift.mjs]
code: [tools/checks/contract-drift.mjs]
---

## Context

`check:contract-drift` evaluates the PR's synthetic merge diff: any
`PRODUCTION_SOURCE_RE` path beside a `draft→ready` flip trips the gate. A hunk
that only rewrites `// TODO(backlog: <area>/<slug>)` markers (relink after an
absorbed/renamed item) is contract plumbing, not source — yet it forces a
separate PR. Candidate: classify a file as source only if some changed hunk
contains a non-TODO-marker line; must not open a hole for real code smuggled
next to a marker (hunk-level check, not file-level).
