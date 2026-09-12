# ADR 0380: Lazy eval compiler and explicit loader paths

Status: Accepted
Date: 2026-09-07

## Context

PR #310's accepted JavaScript-only boot scenario cannot eagerly load the
TypeScript compiler. Three loader edges account for it: discovery, eval
classification and syntax-error markers. `autoDiscoverTsconfigPaths` has no
production caller (repo sweep at d52ef8128: conformance + one unit test only).
Independent DEC-2 review confirmed removal over a new async-loader precondition.

## Decision

1. Supersede all six ADR-0170 Decision bullets: remove automatic discovery,
   parser, config-error policy and discovery caches; remove the option from
   public types. JavaScript callers still passing `true` receive a named
   `NotImplementedError`, never silently changed resolution. ADR-0066 explicit
   absolute `paths` and default Node resolution remain. TypeScript remains a
   production dependency for lazy eval classification.
2. `runNodeEntry` owns async preparation: Acorn first; only a parse failure
   imports the compiler module. Preserve synchronous JavaScript execution
   before the first await and the original eval completion value. The internal
   sync runner receives the prepared compiler; error projection uses the same
   instance, including late-error callbacks.
3. Keep the existing TypeScript-only named gap and JavaScript SyntaxErrors.
   Failed compiler import throws `TypeScript compiler chunk failed to load`
   with the original chunk-load error as cause. No fallback classification.
4. The module holds real TypeScript APIs, including const-marker parsing; no
   replacement parser. Splitting bundlers remove transfer bytes; inlining
   bundlers defer evaluation only (ADR-0052 transform injection unchanged).

## Corrections (active)

2026-09-07: ADR-0382 supersedes D1 and its no-callers premise; the sweep omitted
`examples/vite-like-dev`. Discovery stays after explicit async preload. D2–4
remain active; ADR-0381 owns the browser-scoped compiler distribution.

## Alternatives

- Keep discovery with async preload at loader creation: rejected; synchronous
  public loader gains readiness machinery for a test-only consumer.
- Remove discovery and use explicit paths: chosen; existing ADR-0066 API needs
  no new state or host handshake, while all three eager edges disappear.
- Regex eval classification: rejected; cannot preserve the TypeScript parser's
  existing diagnostic/AST contract.

## Consequences

- Retire tests exclusively asserting removed discovery; retain explicit alias
  and default-resolution tests. Add a loud obsolete-option regression.
- Update internal runner tests only to supply preparation; their existing
  semantic assertions remain. Existing Node eval parity corpus stays intact.
- Evidence: `docs/backlog/runtime-js/reference/lazy-compiler-evidence.md`.
