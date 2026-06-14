---
area: vfs
status: parked
title: Streaming workspace archive formats
created: 2026-06-12
why: JSON workspace archive v1 is dependency-free and enough for source portability, but large trees need streaming export/import and possibly zip/tar interoperability
user_story: As a developer exporting a large, binary-heavy rifty workspace, I want streaming export/import with progress/cancel and zip/tar interop, but today only a whole-buffered JSON archive v1 exists — big trees blow memory and there is no streaming pipeline or `.zip`/`.tar` path.
sources: [ADR-0076]
code: [apps/playground/src/glue/workspace-archive.ts]
---

## Context

The playground can export/import source files through a whole-buffered JSON archive v1. That closes
basic origin portability without a new dependency. It does not solve large-project ergonomics:
streaming export/import, progress/cancel, binary-heavy trees, and zip/tar compatibility need their
own format and likely a dependency or browser streaming pipeline.

## Options or Next

- Gate: a real project where JSON archive size or import latency is painful.
- Then: choose zip/tar or a streaming custom format with an ADR if it adds dependencies or public
  compatibility commitments.

## Reversibility

REVERSIBLE until a public archive format/dependency is chosen.
