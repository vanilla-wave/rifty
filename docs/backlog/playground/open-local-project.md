---
area: playground
status: draft
title: Open a local project into a new rifty Project
created: 2026-07-09
why: The playground can import only its own bounded V1 archive into the active Project; it cannot open a local folder as a new Project without a shared staged provenance transaction.
user_story: As a developer with a local Node project, I want to choose a folder or existing rifty archive and open it as a new Project, but today Import is hidden in the palette and mutates only the current workspace format.
epic: from-intent-to-running-project
blocked_by: [playground/project-ingress-transaction]
sources: [M13, ADR-0165, ADR-0146, docs/backlog/vfs/workspace-archive-scalability.md]
code: [apps/playground/src/workbench/internal/playground-archive.ts, apps/playground/src/workers/playground-archive-integration.ts, apps/playground/src/glue/file-manager-dnd.ts, apps/playground/src/workers/playground-project-authority.ts]
---

## Context

Implement the local source adapter for folder selection and the current bounded Playground V1 archive. Inside the lifecycle owned by `playground/project-ingress-transaction`, it validates source-specific archive/folder structure, writes selected bytes through the supplied root/writer, and returns source provenance; it does not allocate, publish, switch, or clean up project state itself. This is a labeled one-time copy into rifty: no live host-folder sync or writeback is implied. Directory drag currently rejects folders and must not silently flatten them.

ZIP/tar and large streaming archives remain `vfs/workspace-archive-scalability`; this item must not choose a new archive format or dependency. Project provenance/reset semantics stay exclusively with its blocking transaction.

## Reversibility

REVERSIBLE local picker and source-adapter internals under the blocking transaction contract.
