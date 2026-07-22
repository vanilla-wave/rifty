---
area: playground
status: draft
title: One page↔owner correlation substrate, mutations settle on owner terminal or owner death
created: 2026-07-22
epic: extraction-ready-page-realm
sources: [ADR-0305, PR-153-post-merge-audit]
code: [apps/playground/src/glue/owner-vfs-client.ts, apps/playground/src/glue/git-owner-port.ts, apps/playground/src/glue/workspace-file-read-port.ts, apps/playground/src/glue/node-modules-port.ts, apps/playground/src/glue/workspace-archive-port.ts, apps/playground/src/glue/ts-ls-client.ts, apps/playground/src/glue/pty-client.ts, apps/playground/src/glue/project-index-port.ts, apps/playground/src/workbench/internal/playground-session-tools-transport.ts]
why: ~9 hand-rolled correlation engines duplicate the same scaffold and their shared deadline semantics lie on mutation channels — a fired timeout reports failure while the owner may still apply
user_story: As a developer saving a file under a slow owner, I want the save to resolve to the owner's true outcome or an honest owner-death failure, but today the page can report failure and later silently apply.
---

## Context

Absorbs `correlated-broadcast-bridge-helper` (grew from helper-extraction to semantics: ADR-0305 fixed mutation settlement = owner terminal or proven owner death/epoch; reads keep bounded deadlines; excluded axes get no machinery). Refinement: inventory EVERY correlation engine first (mechanism sweep — the five BroadcastChannel ports plus owner-vfs-client, pty-client, project-index-port, session-tools-transport; do not stop at five), classify each channel read vs mutation, spike the carrier/death-signal question per channel — ADR-0305 deliberately does not prescribe it. Land the substrate with `owner-vfs-client` as the first real mutation consumer (no dummy adapter); its RED: commit applying after the old ACK deadline settles as the owner terminal, owner death mid-commit settles as honest unknown-outcome failure. Green paths pinned by unchanged channel contract suites. Fault rows: MessagePort/BroadcastChannel boundary models only (slow owner, owner death/port close, respawn epoch).
