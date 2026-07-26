---
area: npm-client
status: ready
title: Shadow recipe v2 data authority
created: 2026-07-26
why: repeated recipe-authority reviews found schema, admission-feature, and clone-ingress policy duplicated across catalog and installer boundaries
user_story: As a browser-IDE user installing a builtin-substituted package, I want the exact reviewed recipe to remain authoritative after structured clone and reject malformed policy before effects, but today v1 computes drifting errors and the package-private clone seam trusts injected data
epic: honest-shadow-substitutions
sources: [ADR-0328]
code:
  - tools/shadow-registry/src/internal/model.ts
  - tools/shadow-registry/src/internal/codec.ts
  - tools/shadow-registry/src/internal/catalog-source.ts
  - packages/npm-client/src/internal/shadow/admission.ts
  - packages/npm-client/src/installer.ts
---

## Context

Contract+RED reviews of the original recipe-v2 slice repeatedly found one
trust-boundary class: recipe behavior is not fully data-owned. Recipe v1
computes unsupported-version features from request text, its codec cannot
strict-decode schema 2, and the package-private install clone ingress forwards
authority data without validation. Canonical/structured-clone behavior can
therefore drift before later acquisition and materialization work begins.

Dedup on titles, code owners, epic Items, and `epic:` links found no separate
data-authority item. ADR-0328 already decides clone-safe schema 2, named
admission features, strict ingress, and one decoder owner; this item extracts
that decided substrate from the oversized integration slice.

## User scenario

A fresh Workbench project installs either `esbuild@0.28.0` or
`lightningcss@1.32.0` through the normal builtin authority. The package-private
contract seam then passes the same authority through `structuredClone()` and
observes the same admitted recipe, rejection feature, error, and event order.
If that cloned authority is malformed, installation rejects it before a getter,
registry read, Eddy request, VFS read/write, override lookup, warning, or
substitution report.

## Acceptance

- The builtin catalog and both recipes are strict clone-safe schema 2. Recipe
  data owns `semver-admits` admission and the stable unsupported features
  `esbuild.version` and `lightningcss.version`; neither feature is computed
  from request text.
- One shadow-registry decoder validates any package-private schema-2 catalog,
  including admission, acquisition kind and dependency projection maps,
  non-overlap, names, versions, materialization paths/files/bin targets,
  `package.json` identity/bin agreement, bindings/assets, behavior-bearing
  digests, dense arrays, data properties, and exact fields, then returns a
  deeply frozen value. The builtin decoder adds only the committed builtin
  identity check; it does not reimplement shape validation.
- The package-private install seam accepts an `unknown` authority value and
  validates the exact data-property envelope and string-only
  `builtinOverrides` map without invoking accessors, then strict-decodes the
  catalog exactly once at ingress. All validation precedes authority reads,
  registry, Eddy, VFS, override, warning, or reporter effects.
- Canonical and `structuredClone()` authorities produce the same outcome,
  exact error feature/message, and observable event order for direct and
  transitive requests through fresh install, lock replay, and Eddy attempt.
- Schema 1, unknown fields, accessors, sparse arrays, malformed projection/bin
  data, invalid names/paths, projection overlap, `package.json` disagreement,
  and forged catalog or recipe digests reject with
  `ShadowRegistryCodecError`. Invalid input never falls back to builtin data or
  a normal registry install.
- Existing esbuild and LightningCSS builtin install behavior remains green.
  Root exports remain builtin-only; the injected authority is package-private
  test infrastructure, not a public custom-recipe or executable-policy API.
- Add concise shadow-registry and npm-client CHANGELOG entries.

## Parity cases

1. `esbuild@0.28.0` and `lightningcss@1.32.0`, direct and transitive:
   canonical versus structured clone has the same admitted recipe in fresh,
   replay, and Eddy-attempt paths.
2. The same 2 × 2 × 3 matrix with an unsupported request rejects with exact
   recipe-declared feature `esbuild.version` or `lightningcss.version`.
   Direct rejection has zero metadata/tarball/Eddy/VFS effects; transitive
   rejection pins the necessary ancestor packument/tarball (and attempted Eddy
   fallback) order, then performs no rejected-child acquisition or writes.
3. A valid package-private schema-2 fixture survives structured clone and runs
   through the real install ingress without exposing a public recipe SPI.
4. Catalog/recipe/admission/acquisition/projection/materialization/bin/binding
   mutation tables cover exact fields, data descriptors, dense arrays, map
   overlap, names, paths, manifest agreement, schema 1, and behavior digests.
5. Unknown authority envelope fields, envelope/catalog/override accessors,
   non-string override values, malformed clones, and post-clone digest drift
   each reject with the same codec error class, zero getter calls, exactly one
   catalog decode where the envelope is valid, and zero downstream effects.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| corrupt-input | strict decoder rejects malformed envelope, schema, projections, bins, fields, descriptors, arrays, manifests, and digests | codec mutation table plus cloned-ingress cases |
| observable-order | invalid ingress/direct admission has zero effects; transitive admission stops after pinned ancestor discovery | ordered effect ledger |
| sibling-drift | both builtin recipes, direct/transitive, and fresh/replay/Eddy share the same data-driven admission | full cross-product contract |
| provenance-lie | canonical and cloned authority cannot disagree or fall back after digest drift | structured-clone differential |

## Out of scope

- Executing registry dependency projection, bundled-dependency acquisition, or
  lockfile bundle provenance; `npm-client/shadow-recipe-v2-authority` owns that
  integration until a narrower reverse-linked child is created.
- Same-command `.bin` ownership and materialized-bin conflict policy;
  `npm-client/shadow-recipe-v2-authority` owns that integration until a
  narrower reverse-linked child is created.
- Recipe-v2 acquisition/materialization integration, v1 lock migration,
  browser artifact regeneration, and Sass. Until their named slices land,
  existing unsupported surfaces keep their current loud errors and compat ❌.
- A public recipe/plugin API, remote recipe data, callbacks, or remotely
  supplied executable policy.

## Decisions

- ADR-0328 owns schema 2, data-owned admission, strict ingress, and one decoder
  owner. This slice implements only that reusable substrate.
- Generic consumers branch on recipe fields, never on esbuild,
  LightningCSS, Vite, an entry kind, or test-fixture identity.
- The generic strict decoder is internal. Public exports continue to expose
  only the attested builtin catalog and legacy builtin tables.
- Schema 2 is the new ADR-0328-owned internal clone format. This slice adds no
  public API/wire format, dependency, storage authority, or coordination
  mechanism.
