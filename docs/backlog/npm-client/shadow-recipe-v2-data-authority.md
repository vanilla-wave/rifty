---
area: npm-client
status: draft
title: Shadow recipe v2 data authority
created: 2026-07-26
why: repeated recipe-authority reviews found schema and admission-feature policy split between the catalog codec and installer request handling
user_story: As a browser-IDE user installing a builtin-substituted package, I want the exact owner-decoded recipe to determine admission and survive structured clone unchanged, but today v1 cannot express recipe-v2 policy and computes rejection identity from request text
epic: honest-shadow-substitutions
sources: [ADR-0328]
code:
  - tools/shadow-registry/src/internal/model.ts
  - tools/shadow-registry/src/internal/codec.ts
  - tools/shadow-registry/src/internal/catalog-source.ts
  - tools/shadow-registry/src/internal/index.ts
  - tools/shadow-registry/README.md
  - packages/npm-client/src/internal/shadow/admission.ts
  - packages/npm-client/src/installer.ts
---

## Context

Contract+RED reviews of the original recipe-v2 slice found one data-authority
class: recipe behavior is not fully data-owned. Recipe v1 computes unsupported
features from request text and its codec cannot express or strict-decode the
admission, projection, and bin fields decided for schema 2.

The existing real boundary is already deep: shadow-registry decodes generated
catalog JSON at module initialization, then exposes the attested frozen catalog
through its declared `/internal` subpath. npm-client imports that value. There
is no installer catalog-injection or clone ingress, and this slice does not
invent one. Structured clone is exercised directly against the owner codec.

Dedup on titles, code owners, epic Items, and `epic:` links found no separate
data-authority item. ADR-0328 already decides clone-safe schema 2, named
admission features, strict ingress, and one decoder owner; this item extracts
that decided substrate from the oversized integration slice.

## User scenario

A fresh Workbench project installs either `esbuild@0.28.0` or
`lightningcss@1.32.0` through the normal builtin catalog. Shadow-registry
decodes that catalog once before export; a codec differential proves its
structured clone decodes to the same frozen policy. An unsupported request
throws the recipe's stable feature before rejected-package acquisition or VFS
effects, without an injected test authority.

## Acceptance

- The builtin catalog and both recipes are strict clone-safe schema 2. Recipe
  data owns `semver-admits` admission and the stable unsupported features
  `esbuild.version` and `lightningcss.version`; neither feature is computed
  from request text.
- One shadow-registry decoder accepts `unknown`, validates schema 2 admission,
  acquisition kind and dependency projection maps, non-overlap, the
  ADR-0328 internal name/version grammars, materialization paths/files/bin
  targets, `package.json` identity/bin agreement, bindings/assets,
  behavior-bearing digests, dense arrays, data properties, and exact fields,
  then returns a deeply frozen value. The builtin wrapper adds only the
  committed identity check; it does not reimplement shape validation.
- Shadow-registry decodes generated JSON exactly once before the existing
  `/internal` export. npm-client consumes only that attested frozen value and a
  package-private admission helper; neither package exposes an injected
  catalog, custom recipe, callback, or executable-policy API.
- Canonical and `structuredClone()` catalog values decode to the same policy,
  exact error class/path/message, digest, and deep-frozen shape. Admission
  outcomes for direct and transitive requests remain the same through fresh
  install, lock replay, and Eddy attempt.
- Schema 1, unknown fields, accessors, sparse arrays, malformed projection/bin
  data, invalid internal keys/versions/paths, projection overlap,
  `package.json` disagreement, and forged catalog or recipe digests reject with
  `ShadowRegistryCodecError`. Invalid input never falls back to builtin data or
  a normal registry install.
- Existing esbuild and LightningCSS builtin install behavior remains green.
- Update the shadow-registry owner README from superseded ADR-0308 to ADR-0328.
  Root exports remain builtin-only.
- Add concise shadow-registry and npm-client CHANGELOG entries.

## Parity cases

1. The canonical schema-2 catalog and its structured clone strict-decode to
   equal deeply frozen values; a mutation table pins the same codec
   error class/path/message on both representations.
2. `esbuild@0.28.0` and `lightningcss@1.32.0`, direct and transitive, remain
   admitted in fresh, replay, and Eddy-attempt paths.
3. The same 2 × 2 × 3 matrix with an unsupported request rejects with exact
   recipe-declared feature `esbuild.version` or `lightningcss.version`.
   Direct rejection has zero metadata/tarball/Eddy/VFS effects; transitive
   rejection pins the necessary ancestor packument/tarball (and attempted Eddy
   fallback) order, then performs no rejected-child acquisition or writes.
4. Catalog/recipe/admission/acquisition/projection/materialization/bin/binding
   mutation tables cover exact fields, data descriptors, dense arrays, map
   overlap, internal key/version grammars, paths, manifest agreement, schema 1,
   and behavior digests.
5. Catalog/recipe accessors, sparse arrays, malformed clones, and post-clone
   digest drift reject with zero getter calls; npm-client exposes no catalog
   injection seam.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| corrupt-input | strict decoder rejects malformed schema, projections, bins, fields, descriptors, arrays, manifests, and digests without invoking getters | canonical/clone codec mutation table |
| observable-order | direct rejection has zero acquisition/VFS effects; transitive admission stops after pinned ancestor discovery | ordered install effect ledger |
| sibling-drift | both builtin recipes, direct/transitive, and fresh/replay/Eddy share the same data-driven admission | full cross-product contract |
| provenance-lie | canonical and cloned catalogs cannot disagree or survive behavior-bearing digest drift | structured-clone codec differential |

## Out of scope

- Executing registry dependency projection, bundled-dependency acquisition, or
  lockfile bundle provenance; `npm-client/shadow-recipe-v2-authority` owns that
  integration until a narrower reverse-linked child is created.
- Same-command `.bin` ownership and materialized-bin conflict policy;
  `npm-client/shadow-recipe-v2-authority` owns that integration until a
  narrower reverse-linked child is created.
- Any injected/package-private/remote catalog carrier. The current owner
  decodes generated JSON before its existing internal export; future clone
  ingress requires its own contract.
- General npm package-name or request-spec validation. Schema 2 owns only the
  ADR-0328 internal catalog key/version grammar; npm-client keeps request
  parsing.
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
- The strict shape decoder stays owner-internal. The existing declared
  `/internal` subpath exposes only the attested builtin catalog and shared
  primitives; the public root keeps legacy builtin tables.
- Schema 2 is the new ADR-0328-owned internal clone format. This slice adds no
  public API/wire format, dependency, storage authority, or coordination
  mechanism.
