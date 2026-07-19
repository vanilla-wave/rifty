---
area: playground
status: draft
title: Playground runtime-asset cache status and recovery UI
created: 2026-07-17
why: Workbench exposes sanitized asset progress, inspection, and clear recovery, but the first-party Playground has no visible cache status or recovery control
user_story: As a Playground user whose runtime-asset fetch or persistence failed, I want to see what happened and perform the supported recovery flow without writing host code, but today only terminal output and the Workbench API expose it
blocked_by: []
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workbench-content-store.md, docs/adr/distribution/0278-playground-companion-terminal-state-and-preview-registry.md, docs/backlog/vfs/storage-pressure-and-eviction-ux.md, docs/backlog/playground/diagnostics-hub.md]
code: [apps/playground/src/components, apps/playground/src/adapters/playground-workbench-host.ts]
---

## Context

The first-party companion already keeps cold install visible in the default
terminal. ADR-0249 adds semantic progress, `RuntimeAssetError`, and
`workbench.runtimeAssets.inspect()/clear()` without exposing paths, plans,
receipts, URLs, or owner protocol. No Playground control presents storage class,
verified usage, or the prescribed recovery action.

The UI should render only the public vocabulary, distinguish retry from
clear-and-retry, and preserve the idle-only clear contract. For an active
companion session, clear-and-retry means inspect → close session → clear →
reopen → retry; the UI must not invent active clear or silently reload the
project. General origin quota/archive rescue remains owned by
`vfs/storage-pressure-and-eviction-ux`; retained diagnostics and shared action
presentation remain owned by `playground/diagnostics-hub`.

Path to ready: choose the smallest first-party surface and accessibility
contract, pin callback/terminal/error ordering, and add a real Chromium journey
for failure → visible diagnosis → supported recovery → successful Vite start.
