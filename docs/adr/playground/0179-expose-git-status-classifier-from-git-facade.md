# ADR 0179: Expose git status classifier from git facade

Status: Active
Date: 2026-06

> TL;DR: expose the statusMatrix→porcelain-XY classifier from `@riftydev/git`
> so shell and playground SCM use one layer-safe rifty-git status language.

## Context

The SCM/file-manager epic needs one classifier for owner status feed,
decorations, and SCM lists. The existing classifier lived inside the shell git
command. Copying it to playground would let page views share it but would leave
shell status rendering on a second implementation. Importing playground from
shell violates the layer rules.

## Decision

Move the classifier to `@riftydev/git` and export `porcelainXY(code)` through
that package's public API. Shell imports it from its existing git dependency.
Playground wraps it in local feed helpers that produce `{path,code}` entries.

## Consequences

- One rifty-git status classifier serves shell and page projections.
- `@riftydev/git` gains a small public helper; changes to the mapping are now a
  package API change.
- No reverse import or app dependency from lower packages.
