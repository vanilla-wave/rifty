---
area: playground
status: draft
title: Evidence-bounded project compatibility preflight
created: 2026-07-09
why: A developer must currently install and run a project to discover known package/runtime ceilings even when rifty already has a tested incompatibility or explicit compat claim.
user_story: As a developer opening an npm project, I want known blockers and unknown areas identified before install, but I do not want the absence of a catalog match presented as proof that the project works.
epic: honest-compatibility-in-the-ide
blocked_by: [toolchain-build/machine-readable-compat-claim-catalog]
sources: [M11, docs/public/compat/README.md, docs/public/compat/incompatible-packages.md, docs/backlog/process-meta/compat-matrix-coverage-debt.md]
code: [tools/compat-matrix-generator/cli.js, apps/playground/src/glue/project-deps.ts, apps/playground/src/glue/npm-shell-command.ts]
---

## Context

Consume the normalized catalog owned by `toolchain-build/machine-readable-compat-claim-catalog`, including evidence-backed package, runtime, and browser ceilings that also render or validate public compat. Inspect only evidence available without executing: manifest dependency specs, lockfiles, scripts, declared engines, current browser capabilities, and statically provable imports/config. Apply a claim only when its package/version range, Node target, platform/browser predicate, and evidence scope are all resolved; an ambiguous semver range, conflicting lockfiles, or unavailable capability yields `unknown`, not a blocker guessed from a package name. Results are `known blocker`, `known caveat`, `no known blocker`, or `unknown`, each with catalog/test evidence. Never emit a compatibility score or `supported project` verdict.

Transitive/native failures remain authoritative only when the real resolver/installer observes them; a static package-name denylist would drift and is forbidden. Missing catalog coverage stays unknown, matching the public rule that undocumented does not mean supported.

## Reversibility

REVERSIBLE playground analysis over the catalog. Catalog schema/public stability stays with its blocking catalog item.
