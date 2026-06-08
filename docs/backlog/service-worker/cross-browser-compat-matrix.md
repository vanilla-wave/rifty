---
area: service-worker
status: parked
title: browsers.md cross-browser capability/compat matrix (first cross-browser CI run)
created: 2026-06-08
why: docs/public/compat/README.md lists browsers.md as "coming with first cross-browser CI run"; the matrix and the run that generates it are both unfinished
sources: [docs/public/compat/README.md, A-6, A6 (backlog-distribution-and-ide), D-006, ADR-0007]
---
## Context
`docs/public/compat/README.md` indexes the compat matrices and notes `(browsers.md — coming with first cross-browser CI run)`. D-006 / ADR-0007: Chrome-first, best-effort Firefox/WebKit; all-3 Playwright infra exists from M0, cross-browser CI on a weekly cron only. The capability/browser support matrix consumers need (which features work per engine — e.g. transferable streams gating the SSE fast path, COI/SAB availability) does not yet exist; the cron run that would generate it is the unfinished prerequisite. Duplicated ask in the distribution backlog as A6.
## Options / Next
Run the cross-browser CI sweep (`ci-cross-browser.yml`, 3 engines) and generate `docs/public/compat/browsers.md` from the results — a per-engine capability/feature-support matrix (✅/⚠️/❌). Add the README index entry once it lands. Keep manually-curated rows for platform ceilings (e.g. Safari transferable-stream gaps that bound the SSE fast path) until auto-generation covers them.
## Reversibility
Reversible — documentation + CI artifact only (new generated matrix doc, no package API). No ADR conflict; realizes the D-006 / ADR-0007 cross-browser reporting intent. Gate: a green-enough cross-browser cron run to populate the matrix.
