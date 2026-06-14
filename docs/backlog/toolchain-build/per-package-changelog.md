---
area: toolchain-build
status: active
title: Per-package CHANGELOG.md for all @riftydev/* packages
created: 2026-06-08
why: DoD requires a CHANGELOG.md per affected package, but only root + npm-client have one
user_story: As a rifty maintainer ticking the DoD "CHANGELOG.md updated in affected packages" box, I want every published `@riftydev/*` package (io, kernel, vfs, runtime-js, net, shell, …) to carry one, but today only root + npm-client have a CHANGELOG so the per-package check can't be honestly ticked.
sources: [A5, ADR-0070, CLAUDE.md DoD]
---
## Context
CLAUDE.md Definition-of-Done asks "`CHANGELOG.md` updated in affected packages." Convention (docs/ROADMAP.md) is each `packages/*` ships a README.md + CHANGELOG.md. Today only the repo root and `@riftydev/npm-client` carry a CHANGELOG; the other published packages (io, kernel, vfs, runtime-js, runtime-wasi, net, shell, service-worker, sdk, …) have none, so the DoD checkbox can't be honestly ticked per-package. EPIC A follow-up after the ADR-0070 publish pipeline landed.
## Options / Next
Next: add a `CHANGELOG.md` to each published `@riftydev/*` package, seeded from the relevant ADR/Unreleased history; then the DoD CHANGELOG step becomes per-package. Coordinate with A8 (changesets) — if changesets is adopted, the generation/format should match its convention rather than hand-rolling now. Mechanical, one PR.
## Reversibility
REVERSIBLE. Docs-only (new files), no code or public-API change, no new dep. May be subsumed/reshaped by A8 (changesets) if that lands first.
