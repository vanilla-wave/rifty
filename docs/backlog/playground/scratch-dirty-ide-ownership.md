---
area: playground
status: draft
title: Keep Scratch dirty policy within the IDE companion
created: 2026-09-10
why: project VFS and npm command handling currently classify changes according to Scratch dirty semantics
user_story: As a Workbench integrator, I want filesystem and command behavior independent of IDE Scratch state, while the Playground still accounts for edits from the editor, terminal and Git.
sources: [docs/adr/distribution/0278-playground-companion-terminal-state-and-preview-registry.md, docs/adr/playground/0307-install-trust-is-an-install-protocol-commit-not-tree-surveillance.md, docs/backlog/playground/reference/project-open-ide-boundaries-refine.md, docs/backlog/playground/scratch-reset-keeps-page-dirty.md]
code: [packages/workbench/src/workers/workbench-project-vfs.ts, packages/workbench/src/workers/owner-package-state.ts, packages/workbench/src/workers/playground-project-authority.ts]
---

## Context

`workbench-project-vfs` excludes writes inside node_modules specifically for
Scratch dirty. `owner-package-state` recognizes first clean dependency arrival
and reports package-manifest/package-lock mutations to the companion. These
callbacks cross generic filesystem/package handling and await catalog reflection.
The Scratch boolean itself is in the Playground catalog, not the base VFS API.

User direction: «dirty черновика как будто фича про ide и не должна протекать
в другие уровни». Own its meaning in the IDE companion; lower layers provide
filesystem/operation facts without deciding whether a Scratch is unsaved.

## Boundaries

- Preserve current user-visible classification: editor/guest/Git/import edits
  count; starter seed, initial dependency arrival and extraneous install-tree
  writes retain their existing exclusions. No new meaning of dirty is selected.
- Include off-editor writes and preserve their existing close/reload outcomes;
  a page-only editor listener cannot replace the current behavior.
- A companion module may live in the owner Worker. Domain ownership does not
  imply moving durable state to the page or adding another state owner.
- The proven page reconciliation gap remains `scratch-reset-keeps-page-dirty`;
  fixing that gap alone does not establish this ownership boundary, and the
  boundary proposal does not claim that Reset has been fixed.

## Decisions

- 2026-09-10 — user direction is ownership, not a redefinition of edits; existing ADR-0278/0307 semantics remain the baseline.
- 2026-09-10 — reuse existing mutation/publication facilities where sufficient; carrier, public API consequences and any required ADR stay with pickup.

## Challenge

2026-09-10 — fresh read-only `/root/review_open_boundary`:

> Перенос смысла dirty в IDE оправдан. Но IDE должна учитывать факты guest/npm/Git writes; «IDE владеет» не означает «наблюдаем только editor» или «владелец обязательно живёт на странице».

Source and dispositions: `reference/project-open-ide-boundaries-refine.md`.
No new listener, journal, lock or coordination mechanism is selected here.
