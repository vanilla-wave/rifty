---
area: npm-client
status: draft
title: Install-artifact identity hashes documentation-only policy fields
created: 2026-07-25
why: a compat-note wording edit flips the identity, invalidates every deployed install stamp, and forces a multi-MB snapshot rebake
user_story: As a maintainer adding a compat table row to esbuild-runtime-policy.json, I want deployed install stamps and baked snapshots to stay valid, but today the identity hash covers the whole policy file so a doc-only edit forces a stamp invalidation plus a 27 MB rebake.
sources: [docs/backlog/playground/baked-snapshot-regeneration.md, docs/backlog/playground/install-stamp-invalidation.md]
code: [tools/shadow-registry/tools/generate-install-artifact-identity.ts]
---

## Context

`generate-install-artifact-identity.ts` folds `esbuildRuntimePolicy: await readJson(policyUrl)`
— the entire `tools/shadow-registry/esbuild-runtime-policy.json` — into the install-artifact
identity. Behavior-bearing fields there are `wasm`, `source`, `consumer`; the rest
(`currentSurfaces[]`, `unsupportedSurfaces[]`, `gaps[]`, `patchDescriptions`,
`validationSource`) is compat documentation and test-evidence listing.

Observed on PR #175: dddb2e28 added a compat row ("Cold runtime-asset availability") →
identity `589ac7…→6c5764…` (b9571217) → every deployed install stamp invalidated + 27 MB
snapshot rebake forced (8ea826a1), which absorbed an unreviewed `postcss` 8.5.22→8.5.23 bump
(bake resolves against the live registry). Side effect: commits between the doc edit and the
identity refresh fail `check:install-artifact-drift` — bisect-hostile.

Dedup: `playground/baked-snapshot-regeneration` owns rebake cadence/nondeterminism/git size;
`playground/install-stamp-invalidation` owns post-claim corruption revalidation. Neither owns
this coupling: identity input selection.

## Options or Next

- Hash only behavior-bearing policy fields (explicit allowlist in the generator; doc fields
  changing must NOT flip the identity — pin with a test editing a doc field).
- Or split the policy file: behavior policy (hashed) vs compat/evidence doc (unhashed,
  moved next to `docs/public/compat/`).

## Reversibility

REVERSIBLE — generator input selection; no deployed-format change (identity value flips once
when the selection narrows, same as any legitimate refresh).
