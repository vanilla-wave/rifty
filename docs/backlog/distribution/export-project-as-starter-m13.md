---
area: distribution
status: draft
title: M13 — export a project as a Starter / share-by-link / import
created: 2026-06-21
why: ADR-0165 keeps the export/import engine live and the baseline = re-derivable Starter bundle artifact intentionally reusable, but the M13 sharing surfaces (save-as-Starter, share-by-link, import external projects) are explicitly out of scope and ship disabled with a "soon" pill
user_story: As a user with a polished project, I want to publish it as a Starter others can pick (or share a link / import someone's project), but ADR-0165 scopes this to M13 — the Export surfaces are visible-but-disabled today.
sources: [ADR-0165, ADR-0146, ADR-0073]
code: [apps/playground/src/glue/workspace-archive.ts, apps/playground/src/glue/workspace-archive-port.ts, apps/playground/src/presets.ts]
---

## Context

ADR-0165 §9/§11: the export/import logic stays LIVE (owner-resident, ADR-0146) and the baseline mechanism (a Starter bundle, re-derived from the registry) is the SAME shape needed to export a project AS a Starter. Only the launcher row-menu + status-bar Export SURFACES render disabled with a `soon` pill until M13. This item is the M13 work: turn a saved project's tree into a shareable Starter bundle (+ share-by-link, + importing external projects/stands).

Links `create-rifty-template` (host scaffolding) and maps to M12's AI-agent sandbox contract (a shared project IS an agent stand).

## Options or Next

- Project tree → Starter bundle: serialize files[]/openFiles[] + setup/templateId (reuse `WorkspaceArchiveV1`); register as a user Starter in the gallery.
- Share-by-link: bundle → URL-addressable artifact (host/storage decision — its own ADR; touches distribution + privacy).
- Import: external project/archive → a new project (validate templateId resolves loud, ADR-0078).
- Re-enable the disabled Export surfaces.

## Reversibility

IRREVERSIBLE at the points that add a public sharing surface / new dependency / hosting decision → ADR(s) when taken. The bundle-shape reuse is pre-decided by ADR-0165 (no new artifact). Parked until M13.
