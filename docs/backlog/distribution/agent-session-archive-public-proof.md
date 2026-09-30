---
area: distribution
status: draft
title: Prove shared conversation archive through installed SDK and Workbench hosts
created: 2026-09-30
why: Source-level archive tests do not prove installed public consumers or source-project lifecycle.
epic: agent-session-archive
blocked_by: [distribution/agent-session-archive]
sources: [ADR-0482]
code: [tests/integration/workbench-packed-consumer.mjs]
---

## Context

After core archive passes, prove I2/I4 via installed SDK and Workbench consumers:
shared namespace, save/reload, new project recall without transcript or filename,
source rename/delete, project export/import isolation, real-model recall.
Reuse certified capture/storage behavior; no separate archive owner.
