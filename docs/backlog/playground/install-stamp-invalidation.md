---
area: playground
status: draft
title: Install-stamp invalidation strategy
created: 2026-06-12
why: stamp trusts node_modules wholesale; a corrupted-but-stamped tree boots a broken dev server with no self-heal
user_story: As a playground dev with `node_modules` corrupted after a trusted claim was written, want boot to reject that tree instead of starting broken until I hand-run `npm install`.
sources: [docs/adr/playground/0135-sandbox-setup-kinds-instant-vs-from-scratch.md]
code: [apps/playground/src/glue/install-stamp-authority.ts]
---

## Context

ADR-0261 closes root/request/policy drift with exact root, `package.json` text, and install-artifact identity, and proves owner-observed writes before promotion. The residual is later content corruption outside that proof window: a trusted claim does not hash or revalidate the full tree. Current escape hatch: terminal `npm install` demotes the claim and re-installs.

## Options or Next

- Lockfile cross-check at skip time (cheap: lockfile exists + parses).
- Spot-check N package.json files under node_modules against the lockfile.
- Stamp a content hash of the lockfile; mismatch → fall through to install.
- Do nothing until a real corruption shows up (current choice).

## Reversibility

REVERSIBLE — provisional judgment recorded here; reuse is owned by one authority check.
