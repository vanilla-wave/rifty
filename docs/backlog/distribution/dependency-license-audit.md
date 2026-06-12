---
area: distribution
status: parked
title: Dependency licence audit for published install surface
created: 2026-06-12
why: first-party MIT position is documented, but transitive dependency licence audit is broader compliance work and should not block the open-runtime positioning page
sources: [docs/public/open-runtime-position.md, docs/research/open-webcontainers-alternative-2026-06.md]
code: [package.json, pnpm-lock.yaml, packages, tools/shadow-registry]
---

## Context

The public open-runtime position now lives in `docs/public/open-runtime-position.md`: first-party
packages publish as MIT, are self-hostable, and route capability claims through the compat matrix.
What remains unverified is the wider install surface: direct and transitive dependency licences for
published packages, shipped web assets, and tooling that reaches a consumer tarball or deployed app.

## Options or Next

Generate a direct/transitive licence inventory for publishable packages and shipped browser assets.
Flag copyleft, source-available, missing-licence, or custom terms. Decide later whether this becomes
a release checklist, a generated report, or a CI warning. Do not block the positioning page on
this audit.

## Reversibility

REVERSIBLE - documentation and audit follow-up only. Dependency changes or release gates need their own task or
ADR when proposed.
