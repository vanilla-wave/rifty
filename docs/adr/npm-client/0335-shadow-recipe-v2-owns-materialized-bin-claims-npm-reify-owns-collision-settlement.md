# ADR 0335: Shadow recipe v2 owns materialized bin claims; npm reify owns collision settlement

Status: Accepted
Date: 2026-07

> TL;DR: recipe v2 owns exact materialized bin claims, while npm reify history
> owns same-command settlement; rifty supports collision-free scopes and
> loud-throws `npm-client.bin-collision-reify` until it reproduces that complete
> lifecycle.

## Context

ADR-0328 replaced ADR-0308 with one strict, clone-safe recipe authority. Its
admission, acquisition, materialization, provenance, optional-binding, and
generic-consumer decisions remain load-bearing.

ADR-0328 also decided:

> When user-visible packages in one `node_modules` scope claim the same command,
> the lexicographically first package name wins independently of manifest order;
> each install reconciles an existing launcher to that winner.

That model came from a non-discriminating local-`file:` probe. A committed
ordinary packed-tarball differential on Node v24.16.0 / npm 11.17.0 disproves
both clauses:

- fresh install and `npm rebuild` process Arborist's rebuild queue ordered by
  `(node.depth, @isaacs/string-locale-compare('en')(node.path))`; `bin-links`
  gives the first caller each destination;
- an ordinary incremental install rebuilds ADD/CHANGE nodes, so a newly changed
  contender can overwrite the current launcher; a no-op preserves it;
- removing either colliding package removes the shared launcher without
  rebuilding the unchanged survivor;
- unchanged direct `file:` directory Links are rebuilt and therefore cannot
  stand in for registry-package behavior.

Same-command ownership is an operation-history contract, not a comparator over
the final package-name set. This ADR supersedes ADR-0328, grafts its remaining
decisions, and replaces only that false settlement model.

## Decision

- **One strict recipe v2.** The catalog and every recipe use schema 2 and new
  identities. A recipe owns trigger/version, admission, acquisition,
  materialization, user-visible bin claims, provenance, and an optional runtime
  binding. Catalog data is clone-safe and carries no functions.
- **Admission is data.** Each recipe selects `semver-admits` or `exact-only`
  and names the stable unsupported feature. `exact-only` accepts only a
  requested range byte-equal to the trigger version; null, tags, wildcards,
  and semver ranges loud-throw before metadata, tarball, or VFS work. User
  overrides remain outside builtin admission and receive no builtin
  provenance. The concrete features are `esbuild.version`,
  `lightningcss.version`, and `sass-embedded.version`; request text never
  changes their identity.
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
- **Lockfile provenance stays authoritative.** Matching replay regenerates
  exact files and bins with zero registry reads. A v1 recipe identity or any
  acquisition/materialization drift loud-fails `EBROKENLOCK` with reason
  `shadow-trace-drift`; it is never reinterpreted as v2. A v1 identity is
  attributed to its trigger package, with the lexicographically smallest
  `canonicalShadowJson(appliedFact)` winning when multiple legacy facts exist.
  That legacy-trace attribution tie-breaker is unrelated to `.bin` ownership.
  Pre-shadow lockfiles remain ordinary empty plans.
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

- (+) Recipe bins can ship faithfully through one linker without pretending a
  static collision winner exists.
- (+) Acquired twins cannot leak a launcher or lock claim before the
  materialized package becomes visible.
- (+) Adding future recipes changes policy/capsule/oracle/generated data and
  tests unless they need a genuinely new recipe field.
- (+) Sass exact-version, zero-native-acquisition, CLI, and replay promises are
  enforced before observable side effects.
- (+) Direct esbuild and Vite keep one generic adapter path; install-only
  recipes still perform zero manager/store operations.
- (−) Same-command installs remain explicit compat ❌ until rifty owns npm's
  operation-sensitive reify lifecycle.
- (−) Existing v1 shadow lockfiles and baked snapshots change identity and
  require regeneration/reinstall; failure is loud, never approximate replay.
- (−) Registry metadata is part of the attested recipe contract; a changed
  exact-version manifest requires an explicit policy/catalog update.
- Follow-up: `npm-client/npm-11-bin-reify-authority` owns the complete collision
  lifecycle outside the active shadow-substitution goal.
- Follow-up: `npm-client/sass-embedded-substitution` proves v2 through real
  Node differential tests and Vite 7.3.6 SCSS dev/HMR/build.
