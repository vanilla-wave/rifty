---
area: playground
status: draft
title: Atomic project ingress transaction for every external source
created: 2026-07-09
why: Local import and Git clone can both create a Project, but independent validate/write/publish paths would drift and could expose a partially written tree as usable state.
user_story: As a developer opening an external project, I want my current Project preserved until the complete new tree is atomically committed in the active storage backend, regardless of whether its bytes came from a folder, archive, or Git.
epic: from-intent-to-running-project
sources: [M13, ADR-0165, ADR-0146]
code: [apps/playground/src/workers/playground-project-authority.ts, apps/playground/src/workers/playground-archive-integration.ts, apps/playground/src/workbench/playground.ts]
---

## Context

Extend the current owner-authoritative staged catalog/archive machinery into one validate → stage → publish transaction consumed by every new-project ingress source. The transaction allocates an unpublished root, invokes the selected adapter/writer inside its lifecycle, validates paths and required project metadata, commits provenance/reset metadata with the backend's real persistence state, then publishes the owner catalog and switches once. Cancel, validation failure, source failure, quota loss, owner restart, and reload during staging must leave the current project untouched and must never surface the partial root as a Project. The result is durable only when the active OPFS backend reports persistence; memory fallback remains explicitly ephemeral.

The transaction gives a source adapter a root/writer and accepts its provenance result; folder/archive enumeration belongs to `playground/open-local-project`, and smart-HTTP checkout belongs to `playground/open-git-project`. Adapter errors terminate this one lifecycle, so cleanup/recovery is not reimplemented per source. It does not choose install commands or runtime plans. Before `ready`, its ADR must record how an external project satisfies ADR-0165's required `starter` and reset baseline without inventing a fake starter.

## Reversibility

IRREVERSIBLE project provenance/reset and publication contract → ADR before `ready`; internal staging mechanics are reversible.
