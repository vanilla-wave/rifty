# ADR 0364: One npm package-bin normalization authority follows active npm package-json semantics

Status: Accepted
Date: 2026-08

> TL;DR: every raw npm `bin` form crosses one browser-safe package-private
> normalizer matching npm 11's active `@npmcli/package-json` semantics before
> claims, install results, or lock facts consume it.

## Context

Rifty accepted string/object `bin` metadata at several typed ingresses, then
`linker.ts` silently discarded object commands containing `/` and rejected
absolute/traversal targets. npm 11.17.0 instead sanitizes those keys and roots
those targets inside the package. A successful Rifty install could therefore
omit a real CLI or reject a manifest npm installs.

The pinned local-tarball differential is
`docs/backlog/npm-client/reference/npm-11-package-bin-normalization-probe.mjs`
plus its golden, on Node v24.16.0 / npm 11.17.0. It covers string, array, and
object forms through direct normalization, fresh install, and offline replay.
Reproduce with
`node docs/backlog/npm-client/reference/npm-11-package-bin-normalization-probe.mjs | cmp - docs/backlog/npm-client/reference/npm-11-package-bin-normalization-probe-output.json`.
The active npm authority is `@npmcli/package-json@7.0.5/lib/normalize.js`
(SHA-256
`ba75d512103e404d6125fb658211069f3eb0db0d6687d499130cd86a2b817014`),
followed by an idempotent `npm-normalize-package-bin@5.0.0` pass. The latter
alone is not a valid oracle: it chooses a different target for a sanitized key
colliding with an existing canonical key and keeps target colons.

This is a cross-package public input expansion and an external-semantics data
authority, so decision-workflow rules 1 and 4 require an ADR and differential.
Candidates:

- Add `@npmcli/package-json` and call it directly. Rejected: its package-wide
  Node `fs`, glob, git, and manifest machinery is not browser-safe and is far
  wider than the finite synchronous `bin` contract.
- Add legacy `npm-normalize-package-bin`. Rejected: besides a new dependency,
  the probe proves its collision and target-colon behavior differs from npm's
  real install path.
- Keep raw metadata through registry/result/lock and normalize independently
  at each linker consumer, retaining strict target rejection. Rejected:
  duplicated semantic authority already drifted and contradicts fresh/replay
  npm behavior.
- Copy only the active finite `bin` algorithm behind one package-private pure
  seam and bind it to the differential. Chosen: smallest browser-safe carrier,
  one owner, no new dependency.

## Decision

- Public raw ingress uses one `PackageBin` type: string, readonly string array,
  or readonly object with unknown target values. `VersionManifest` and public
  `ResolvedPackage` refer to it; `PackageBin` is exported only through
  `src/index.ts`. `NormalizedPackageBin` and `NormalizedResolvedPackage`
  expose the canonical output: `InstallResult.packages` and lock entries never
  type raw forms as already-normalized facts.
- One package-private `normalizePackageBin(name, bin)` returns either an exact
  readonly string map or absence. It clones object/array input, then reproduces
  npm's in-place delete/rename/assign order; a fresh-map last-writer loop is not
  equivalent for canonical-key collisions.
- Commands replace backslash/colon with `/`, root-collapse dot/traversal, then
  take the basename. Targets replace backslash/colon with `/` and root-collapse
  dot, absolute, and traversal segments inside the package. String form uses
  the package-name basename. String-array form derives commands from entry
  basenames before the same object pass.
- npm-removed forms stay npm-removed: absent/falsy/primitive top-level values,
  empty maps, empty keys/targets, and non-string object targets produce no
  corresponding claim. A non-string array member cannot produce a map and is
  the named compatibility ceiling
  `NotImplementedError('npm-client.package-bin.non-string-array-entry')`.
- Public linking accepts raw forms but normalizes before collision preflight.
  Registry resolution and lock replay normalize before producing installed
  packages; install results and written lock entries carry only the canonical
  map. Direct lock construction uses the same seam. Tarball `package.json`
  bytes remain untouched, matching npm.
- Existing package-bin source/aggregation/link-ingress contracts that rejected
  rooted absolute/traversal targets are superseded by this oracle. Tar member
  and install-path traversal rejection is unchanged. Canonicalized command
  collisions still enter ADR-0361's existing
  `npm-client.bin-collision-reify` preflight before VFS mutation.
- No public normalizer function, runtime dependency, new layer, or coordination
  mechanism is added.

## Consequences

- (+) Registry install, replay, direct link, install results, and lock facts
  cannot silently disagree on launcher names or targets.
- (+) The browser implementation matches the active npm pipeline, including
  the two cases where the legacy helper differs, without importing Node-only
  package machinery.
- (+) Rooting traversal is safe: normalized targets remain package-relative
  before the linker joins them beneath the owning package.
- (-) The finite semantic copy must be refreshed when the pinned npm authority
  changes; the executable differential makes drift explicit.
- (-) Non-string array members stay a loud named gap instead of reproducing
  Node's host-specific `path.basename` TypeError text.
