# ADR-0488: Use npm semver subset rules for installed dependency saves

Date: 2026-09-30. Status: accepted.

## Context

ADR-0487 D3 requires native npm save semantics. A tilde-prefix heuristic
fails for partial, bounded and union ranges. Node24.16/npm11.17 (semver7.8.4)
uses subset(^resolved, requested): preserve a requested range only when the
saved default would admit versions outside it; exact versions/tags use the
save prefix. Shared real-installer/native probes are recorded in
`docs/backlog/distribution/reference/agent-npm-install-evidence.md`.

## Decisions

1. Workbench declares semver7.8.4 and its development types. Use its valid,
   validRange and subset functions in existing save shaping, with npm's loose
   comparison. Exact-save uses the resolved version. No new resolver or API.
2. Preserve the original requested range when native npm preserves it; never
   reconstruct it from a leading operator. Existing bare-name range and section
   retention stays in ADR-0487's existing path.

## Alternatives and evidence

- Prefix patch for ~2: rejected by real ~2.0, bounded and union-range failures.
- Own subset implementation: rejected; reproduces npm's full comparator algebra
  merely to save a string. Existing npm-client matchesRange is membership only.
- npm's semver: selected, same dependency/version as the pinned native oracle;
  genuine tarballs and differential tests cover shared shell and Worker paths.

Consequence: one small runtime dependency; packed browser tests prove bundling.
