---
area: toolchain-build
status: draft
title: Machine-readable compatibility claim catalog for the IDE
created: 2026-07-09
why: Compatibility claims span generated module matrices and hand-maintained package/runtime/browser decisions, so an IDE catalog derived from only the generator would silently omit known ceilings or copy them into a drifting second inventory.
user_story: As a developer reading a compatibility warning in the IDE or public docs, I want both surfaces to name the same status, caveat, and evidence, but today there is no normalized source covering all claims the project preflight needs.
epic: honest-compatibility-in-the-ide
blocked_by: [toolchain-build/compat-matrix-test-result-sink]
sources: [M11, ADR-0007, docs/public/compat/README.md, docs/public/compat/incompatible-packages.md, docs/public/compat/package-tooling.md, docs/backlog/process-meta/compat-matrix-coverage-debt.md]
code: [tools/compat-matrix-generator/cli.js, docs/public/compat]
---

## Context

Define one deterministic catalog with stable claim id, feature/package/runtime scope, applicability predicates (package/version range, Node target, platform and required browser capabilities), status, classification/reason, caveat, exact test or source references, and coverage state. It must cover all generated matrix rows plus the hand-maintained package-tooling, incompatible-package, process, WASI, and ADR-0007 browser-support claims needed by project preflight. Markdown/decision claims and the catalog render from one normalized claim or mechanically validate one another; a copied package denylist is forbidden.

The test-result sink remains the integrity owner for generated row status. This item owns migration/coverage of the finite hand-maintained domains named above and the build artifact consumed by the playground. Known claims carry an explicit coverage state; when no catalog claim matches a project fact, consumers report `unknown`, never supported. Contradictions or missing evidence on a known claim fail generation instead of choosing a convenient surface.

## Options or Next

- Keep the catalog as a private build artifact until a consumer requires public schema stability.
- Choose per-page render-from-data versus bidirectional validation during refinement; no claim may have two editable authorities.

## Reversibility

REVERSIBLE while the catalog is a private build artifact. Exported schema or public package surface is IRREVERSIBLE → ADR before `ready`.
