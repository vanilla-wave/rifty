---
area: playground
status: draft
title: Explicit install and run plan for imported projects
created: 2026-07-09
why: Imported files do not identify which dependency install or package script the user intends, and guessing a dev command would turn a successful import into a misleading boot path.
user_story: As a developer who opened a real npm project, I want to review scripts and known blockers, then explicitly install and run one, but today import only applies files and refreshes the snapshot.
epic: from-intent-to-running-project
blocked_by: [playground/project-ingress-transaction, playground/project-compatibility-preflight]
sources: [M11, M13, docs/public/compat/package-tooling.md]
code: [apps/playground/src/workers/playground-archive-integration.ts, apps/playground/src/workers/package-acquisition-authority.ts, apps/playground/src/workers/workbench-project-runtime.ts, apps/playground/src/adapters/playground-app.tsx]
---

## Context

After owner archive import, read the real `package.json` through the ProjectSession, show scripts/entry evidence, detected `packageManager`, every lockfile marker, and the compatibility preflight, then let the user choose: install, run a named script, or open the terminal without running. Enable Install only when the catalog proves rifty's package path supports that manager and lockfile version. An explicitly unsupported manager/lockfile is a linked blocker; conflicting markers or a manager with no applicable claim stay `unknown` with Install disabled. Never silently invoke rifty npm for another manager or overwrite/ignore its lockfile. Preserve raw npm/script output and real exit code; discover preview only from owner-published ports. Absence of a recognized script is not an error and must not trigger a guessed `npm run dev`.

The run plan needs a runtime-neutral project identity rather than assigning an arbitrary existing `ProjectSpec`; this item owns that runtime-plan ADR separately from the ingress transaction's provenance/reset/publication ADR. `No known blocker` is not permission to claim the project is supported.

## Reversibility

IRREVERSIBLE imported-project runtime-plan identity → this item's ADR before `ready`; UI sequencing is reversible.
