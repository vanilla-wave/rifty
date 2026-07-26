# ADR 0328: Shadow recipe v2 owns exact admission acquisition and user-visible bins

Status: Accepted
Date: 2026-07

> TL;DR: one clone-safe recipe v2 owns admission, exact acquisition dependency
> projection, materialization, user-visible bins, provenance, and an OPTIONAL
> runtime binding; generic consumers execute policy data and never recognize
> Sass, esbuild, LightningCSS, Vite, or an entry kind.

## Context

ADR-0308 replaced the #160 quarry's Vite/esbuild-first path with one builtin
package-generic registry. Its core direction worked: direct esbuild and Vite
share one adapter, registry aliases carry lockfile provenance, and install-only
recipes create no runtime asset capability.

The second substitution exposed three facts that v1 did not own:

- `matchesRange()` admitted `^1.100.0`, `*`, and other ranges although Sass was
  proven only for the literal `sass-embedded@1.100.0` request;
- registry acquisition copied every optional dependency from the source
  manifest, so `sass` reached native `@parcel/watcher` despite the decided
  watch-mode exclusion;
- the linker wrote the acquired package's bin before alias materialization, so
  the real pure-Sass CLI leaked through `.bin/sass` instead of the promised
  `NotImplementedError('sass-embedded.cli')`.

These are one missing authority, not three Sass exceptions. ADR-0308's claim
that Sass would change no generic file is therefore false. This ADR supersedes
ADR-0308 and grafts its remaining decisions.

## Decision

- **One strict recipe v2.** The catalog and every recipe use schema 2 and new
  identities. A recipe owns trigger/version, admission, acquisition,
  materialization, user-visible bins, provenance, and an optional runtime
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
- **Materialization owns bins.** A recipe records its exact bin map. Acquired
  registry bins never enter linking or their lock entry. After alias files are
  materialized, the shared package-bin linker creates `.bin` launchers from
  the materialized package and validates every target. Synthetic recipes use
  the same bin authority. When user-visible packages in one `node_modules`
  scope claim the same command, the lexicographically first package name wins
  independently of manifest order; each install reconciles an existing
  launcher to that winner. Acquired registry twins are suppressed before this
  policy runs. No second bin implementation is allowed.
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

- (+) Adding future recipes changes policy/capsule/oracle/generated data and
  tests unless they need a genuinely new recipe field.
- (+) Sass exact-version, zero-native-acquisition, CLI, and replay promises are
  enforced before observable side effects.
- (+) Direct esbuild and Vite keep one generic adapter path; install-only
  recipes still perform zero manager/store operations.
- (−) Existing v1 shadow lockfiles and baked snapshots change identity and
  require regeneration/reinstall; failure is loud, never approximate replay.
- (−) Registry metadata is now part of the attested recipe contract; a changed
  exact-version manifest requires an explicit policy/catalog update.
- Follow-up: `npm-client/sass-embedded-substitution` proves v2 through real
  Node differential tests and Vite 7.3.6 SCSS dev/HMR/build.
