# ADR 0325: CJS module records own Node metadata and lifecycle

Status: Accepted
Date: 2026-07-26

> TL;DR: the existing ModuleRegistry record is the sole Node-observable CJS
> `module` object and owns its metadata, graph links, cache, and load lifecycle.

## Context

`nodemon@3.1.14` reads `module.parent.filename` and walks parent links. Rifty's
CJS loader caches execution but does not expose the Node record lifecycle.
Adding a metadata facade beside ModuleRegistry would split identity in cached
loads, cycles, and failures. ADR-0294 already made the registry and `_compile`
the shared CJS dispatch owner.

## Decision

- One ModuleRegistry record is passed to CJS as `module` and published in the
  cache before evaluation.
- It owns Node-shaped `id`, `filename`, `path`, `paths`, `exports`, first
  `parent`, ordered/deduplicated `children`, and `loaded`.
- The first successful requesting parent remains `parent`; later cached
  requires do not rewrite it. A parent links the child before its body runs, so
  cycles observe the same record and partial `exports`.
- `loaded` is false during evaluation and flips true only after success.
  Evaluation failure removes the cache entry and its parent linkage before a
  retry can begin.
- Resolver, cache, `_compile`, and module metadata share this record. No second
  module graph or post-evaluation projection is allowed.
- The public `require.cache` facade, deletion, and reload semantics remain a
  separate blocked contract; this decision supplies the records it will expose.

## Consequences

- Nodemon and other CJS consumers receive stable Node module identity through
  fresh, cached, cyclic, and failed loads.
- Loader APIs and record types widen, but ESM namespace caching and explicit
  HMR invalidation retain their existing owners.
- Differential cases must cover first-parent identity, pre-evaluation linking,
  deduplication, cycle visibility, success transition, and failed-load unlink.

References: ADR-0004, ADR-0294,
`docs/backlog/playground/reference/nodemon-3.1.14-reachability.md`.
