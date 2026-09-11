---
area: distribution
status: draft
title: Preview URL needs for generic SDK consumers and the AI demo
created: 2026-09-11
why: The earlier agent API item retained a preview question outside the accepted no-COI files and commands contract
sources: [docs/adr/distribution/0418-no-coi-project-files-and-invocation-commands.md, docs/backlog/distribution/reference/issues325-326-refine-evidence.md]
---

## Question

Do broader generic sandbox/demo scenarios need preview URL normalization beyond
existing no-COI toolchain.startBin previewUrl (ADR-0377)? Determine this from the
actual consumer scenario; the earlier blanket claim that SDK consumers lack a
URL is stale. No new preview API or resident/finite coexistence is prescribed.

Owner: distribution/ai-sandbox-reference-demo and epics/open-bolt-ai-sandbox-demo.
Trigger: pickup of their live-preview scenario. Commands and project files are
delivered under ADR-0418; this inherited preview question was explicitly outside
#325/#326 and remains unresolved.
