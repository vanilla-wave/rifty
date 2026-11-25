---
area: toolchain-build
status: draft
title: Can a published package tarball carry a non-public registry host?
created: 2026-11-25
why: The lockfile guard (PR #465) covers committed bytes only; nothing checks the packed tarballs of published `@riftydev/*` packages for a mirror host picked up at build time.
sources: [PR #465, docs/backlog/toolchain-build/committed-lockfile-registry-host-guard.md]
code: [tools/checks/lockfile-registry.mjs, tools/checks/third-party-notices.mjs, tools/publishing/sync-publish-config.mjs]
---

## Context

Searched 2026-11-25: `tools/publishing/`, `check:publish-config-drift`,
`check:third-party-notices` (reads packed files), packed-consumer tests
(`tests/integration/workbench-packed-consumer*.{mjs,test.ts}`) — none asserts
the absence of a registry host in packed files. Known inputs: packages'
`files` is `dist` + `CHANGELOG.md` (no lock is packed);
`packages/npm-client/src/registry.ts` `getRegistryBaseUrl()` reads the host at
runtime (bootstrap global, `import.meta.env.RIFTY_REGISTRY_URL`, then
`process.env.REGISTRY_BASE_URL`), default `/npm-registry`; workbench asset
builds (`tools/publishing/build-workbench-assets.mjs`) define no registry
value. No baking path observed; not proven absent.

## Question

Is there a build path (tsup/vite `define`, inlined `import.meta.env`, bundled
fixture or snapshot) by which a release built on a mirror-configured machine
ships the mirror host in a tarball? If yes: one packed-file scan beside
`check:third-party-notices` (it already reads the packed files); if no:
record the reason here and delete.
