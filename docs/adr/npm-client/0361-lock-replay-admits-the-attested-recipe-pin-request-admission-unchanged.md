# ADR 0361: Lock replay admits the attested recipe pin; request admission unchanged

Status: Accepted
Date: 2026-08

> TL;DR: request-shape admission (`semver-admits`/`exact-only`) governs LIVE
> resolution only; lockfile replay of a recorded edge admits exactly the
> recipe's attested pinned product — npm ci parity — while trace validation
> stays the sole substitution authority. Supersedes ADR-0335 (grafts its
> decisions verbatim, amends the two admission/replay clauses).

## Context

ADR-0335 (superseding ADR-0328) made admission data: `exact-only` accepts only
a requested range byte-equal to the trigger version and loud-throws every other
request text. The faithful-npm-lock-replay epic then made replay traverse
lock-pinned peer edges and recorded `optionalDependencies` edges — feeding
their npm-recorded RANGES (vite peers on `sass-embedded@^1.70.0`) into that
request-shape gate. Consequence, observed 2026-08-19: a tree rifty itself
installed (root literal `sass-embedded@1.100.0` admitted, facade materialized,
lock written) refused to replay from its own lock —
`NotImplementedError('sass-embedded.version')` — contradicting ADR-0335's own
"Matching replay regenerates exact files and bins with zero registry reads".

External oracle (`docs/backlog/npm-client/reference/npm-11-lockfile-replay-probe-output.json`
`rangePeer`, Node v24.16.0 / npm 11.17.0): npm records a peer RANGE verbatim on
the entry, pins the exact version, and `npm ci` reifies it with exit 0 without
re-resolving. At replay, the version authority is the PIN, not the range text.
Treating replayed edge ranges as user requests is a `frozen-assumption`.

Alternatives weighed (decision memo, 2026-08-19): keep exact-only on replay
(breaks rifty's own locks, contradicts npm ci); skip recipe-named peer/optional
edges at replay (silent coverage hole, name-special-casing in generic code);
rewrite ranges to literals at write time (byte-level format fork from npm,
provenance-lie on entries). Rejected; recorded-attested-pin admission chosen.

## Decision

Clauses graft ADR-0328/0335 verbatim except the two amended below.

- **One strict recipe v2.** The catalog and every recipe use schema 2 and new
  identities. A recipe owns trigger/version, admission, acquisition,
  materialization, user-visible bin claims, provenance, and an optional runtime
  binding. Catalog data is clone-safe and carries no functions.
- **Admission is data; replay admits the attested pin.** (Amended.) Each recipe
  selects `semver-admits` or `exact-only` and names the stable unsupported
  feature. REQUEST resolution — any live registry/root/manifest-authored edge —
  is unchanged: `exact-only` accepts only a requested range byte-equal to the
  trigger version; null, tags, wildcards, and semver ranges loud-throw before
  metadata, tarball, or VFS work. LOCK REPLAY of a recorded edge
  (lockfile-origin traversal and incremental reuse decisions) never
  re-litigates the recorded range: the edge is admitted exactly and only when
  the recorded entry at the effective path IS the recipe's attested product
  version — the registry acquisition version for registry recipes, the
  materialization version for synthetic recipes — AND the recorded range
  semantically admits the trigger version (an out-of-sync lock, whose pinned
  trigger version does not satisfy its own recorded edge, is refused by npm too
  — `npm ci` EUSAGE); any other recorded version, an unsatisfied recorded
  range, or a missing entry keeps the request-shape loud throw. Replay admission never
  attests: the strict v2 shadow-trace validation (catalog/recipe digests,
  acquisition name/version/resolved/integrity, materialization bytes) remains
  the sole authority that the pinned product is rifty's; an unattested or
  drifted trace stays `EBROKENLOCK`/`shadow-trace-drift`. User overrides remain
  outside builtin admission and receive no builtin provenance. The concrete
  features are `esbuild.version`, `lightningcss.version`, and
  `sass-embedded.version`; request text never changes their identity.
  ADR-0344's "every request other than literal `1.100.0` throws
  `sass-embedded.version`" reads on REQUESTS and stays literally true and
  active; replay of the attested pin is reification, not a request.
- **Registry acquisition is exact.** A registry recipe records required,
  optional, omitted-optional, and peer dependency maps, bundled membership,
  plus a stable drift feature. Bundled names must belong to a retained required
  or optional map. Metadata must equal that complete projection before tarball
  work. Only non-bundled required/retained optional and peer maps enter the
  external walk; omitted optionals never resolve or fetch. Omission and bundle
  membership retain the exact range, so changed metadata cannot silently widen
  policy.
- **Materialization owns bin claims.** A recipe records the exact user-visible
  bin map. Acquired registry-twin bins are removed from package linking and
  lock facts before claims are collected. After package files and registry
  aliases settle, the sole shared package-bin linker validates materialized
  targets and writes launchers for synthetic and registry recipes. Recipe data
  determines who may claim a command; it does not invent collision settlement.
- **npm reify history owns collision settlement.** For ordinary packed registry
  packages, same-command ownership is operation-sensitive. Fresh install and
  `npm rebuild` use the depth/English-locale full-path rebuild order.
  Incremental ADD/CHANGE may overwrite the launcher; no-op preserves it;
  removing either contender removes it without rebuilding an unchanged
  survivor. Local `file:` directory Links are a distinct lifecycle. Rifty may
  claim collisions only after reproducing this complete matrix.
- **Collision-free compatibility boundary.** Until that lifecycle ships, each
  command in each `node_modules` scope must have one unambiguous current
  claimant and authoritative prior state must require no collision transition.
  A current duplicate, recorded prior collision, or owner transition requiring
  ADD/CHANGE/no-op/remove/rebuild semantics throws
  `NotImplementedError('npm-client.bin-collision-reify')` before project-tree,
  substitution-report, or lock mutation. Acquired registry twins are excluded
  before this gate. No lexical, code-unit, manifest-order, or final-tree
  recomputation fallback is permitted.
- **Strict ingress.** The codec rejects v1, unknown fields, accessors, sparse
  data, invalid or overlapping dependency maps, escaping/missing bin targets,
  and disagreement between materialization data and synthesized
  `package.json`. Package-bearing catalog fields use one internal ASCII key
  grammar: unscoped `[A-Za-z0-9][A-Za-z0-9._+-]*`, or scoped
  `@[A-Za-z0-9][A-Za-z0-9._+-]*/[A-Za-z0-9][A-Za-z0-9._+-]*`. Exact versions
  use `MAJOR.MINOR.PATCH` plus optional ASCII prerelease; bin commands use the
  unscoped key form and their normalized relative targets must exist in the
  materialization. These are clone-format constraints, not replacement npm
  request/bin parsers. Recipe/catalog digests cover all behavior-bearing
  fields.
- **One ingress owner.** Shadow-registry strictly decodes the generated catalog
  once before its existing declared `/internal` export; consumers receive that
  attested deeply frozen value and do not accept injected catalogs. Structured
  clone is a codec differential, not a test-only installer carrier. Any future
  published or clone ingress must decode exactly once. Root exports resolve per
  symbol: delete unused exports, or use a declared internal subpath plus shared
  consumer contract suite for repo-shared values.
- **Runtime binding stays optional.** Recipes with a binding feed the one
  owner-bundled executable-adapter registry. Install-only recipes yield exact
  substitution facts and an empty asset/binding plan. Generic
  owner/admission/bootstrap sees only attested facts and adapter ids; remote
  data never activates host code. No public callback/plugin SPI admits
  third-party executable policy.
- **Standard asset sourcing stays.** The quarry's shadow-specific Eddy source
  measured slower than the standard registry path on the same required set
  (median 1517 ms vs 1358 ms, speedup 0.89×), so it remains rejected. General
  npm Eddy is unchanged.
- **Lockfile provenance stays authoritative.** (Amended: one sentence added.)
  Matching replay regenerates exact files and bins with zero registry reads.
  Replay materializes lock-pinned peer and recorded optional edges whose
  npm-recorded ranges point at a recipe trigger onto the attested pin — the
  pin, not the recorded range, is the replay version authority. A v1 recipe
  identity or any acquisition/materialization drift loud-fails `EBROKENLOCK`
  with reason `shadow-trace-drift`; it is never reinterpreted as v2. A v1
  identity is attributed to its trigger package, with the lexicographically
  smallest `canonicalShadowJson(appliedFact)` winning when multiple legacy
  facts exist. That legacy-trace attribution tie-breaker is unrelated to `.bin`
  ownership. Pre-shadow lockfiles remain ordinary empty plans.
- **Concrete recipes.**
  - esbuild keeps semver admission, synthetic materialization, the existing
    optional runtime binding, and a materialized `esbuild` bin;
  - LightningCSS keeps semver admission and the exact `lightningcss-wasm`
    registry twin with required bundled `napi-wasm@^1.0.1`, no optional/peer
    dependencies, acquisition-drift feature `lightningcss.acquisition`, and no
    runtime binding;
  - `sass-embedded@1.100.0` is exact-only, acquires exact `sass@1.100.0`,
    projects its three required dependencies, omits only exact
    `@parcel/watcher`, materializes the ADR-0310 facade and loud CLI, and
    creates no runtime binding; its acquisition-drift feature is
    `sass-embedded.acquisition`.
- **Existing boundaries stand.** Kernel entry ports are unchanged. Vite is an
  acceptance consumer, never an activation condition. The runtime-asset seam
  remains N=1 until a real second Pattern-2 consumer lands.

## Consequences

- (+) A tree rifty installed replays from its own lock — `npm ci` parity for
  npm-recorded peer/optional ranges over attested pins.
- (+) No silent substitution widening: only the exact attested product version
  replays without request admission; every other pin keeps the loud
  `*.version` throw before VFS work, and trace validation still refuses
  unattested or drifted substitutions.
- (+) All ADR-0335 recipe/bin/ingress/collision decisions carry forward
  unchanged; recipe data, catalog schema, and digests are untouched — the
  amendment changes admission COMPUTATION at replay call sites only.
- (−) `exact-only` no longer describes replay behavior by itself; the
  request/replay boundary defined here must accompany any future admission
  kind.
- Supersedes ADR-0335 (removed; all other clauses grafted verbatim). ADR-0344
  stays active — its version-surface clause reads on requests and is
  unaffected.
