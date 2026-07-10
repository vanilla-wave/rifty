---
area: playground
status: draft
title: Open a local project into a new rifty Project
created: 2026-07-09
why: The playground can import only its own whole-buffer JSON archive into the active root; it cannot open a local folder as a new project without risking partial replacement or losing project provenance.
user_story: As a developer with a local Node project, I want to choose a folder or existing rifty archive and open it as a new Project, but today Import is hidden in the palette and mutates only the current workspace format.
epic: from-intent-to-running-project
blocked_by: [playground/project-ingress-transaction]
sources: [M13, ADR-0165, ADR-0146, docs/backlog/vfs/workspace-archive-scalability.md]
code: [apps/playground/src/glue/workspace-archive.ts, apps/playground/src/glue/workspace-archive-port.ts, apps/playground/src/glue/file-manager-dnd.ts, apps/playground/src/orchestration/workspace-files.ts]
---

## Context

Implement the local source adapter for folder selection and existing `WorkspaceArchiveV1`. Inside the lifecycle owned by `playground/project-ingress-transaction`, it validates source-specific archive/folder structure, writes selected bytes through the supplied root/writer, and returns source provenance; it does not allocate, publish, switch, or clean up project state itself. This is a labeled one-time copy into rifty: no live host-folder sync or writeback is implied. Directory drag currently rejects folders and must not silently flatten them.

ZIP/tar and large streaming archives remain `vfs/workspace-archive-scalability`; this item must not choose a new archive format or dependency. Project provenance/reset semantics stay exclusively with its blocking transaction.

## Reversibility

REVERSIBLE local picker and source-adapter internals under the blocking transaction contract.
