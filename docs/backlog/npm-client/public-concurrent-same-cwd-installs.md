---
area: npm-client
status: draft
title: Public concurrent same-cwd installs need one transaction authority
created: 2026-07-28
why: two supported install calls can both succeed while the lockfile and bin launcher attest different trees
user_story: As an npm-client SDK user, I want concurrent installs targeting one physical root to serialize or reject before mutation, but today they can publish torn successful state
sources: [ADR-0261, ADR-0278, npm-client/reference/public-concurrent-same-cwd-install-probe]
code:
  - packages/npm-client/src/installer.ts
  - packages/npm-client/src/linker.ts
  - packages/npm-client/src/installer-lockfile-reader.ts
---

## Context

`@riftydev/npm-client` exports `install()` and `@riftydev/sdk/npm-client`
re-exports it without an authority or exclusion precondition. The executable
probe at source SHA-256
`79fadaa1e34527f74d729a528416e75de820d921b47fd79f7803ceb20f65b995`
parks provider-z before its lock write, lets provider-a finish, then resumes
provider-z:

```sh
node --import tsx \
  docs/backlog/npm-client/reference/public-concurrent-same-cwd-install-probe.mjs
```

Both calls succeed. The final lock contains only provider-z,
`.bin/shared` imports provider-a, and both package directories remain. This is
a `concurrent-same-key` torn-success failure, not npm-client's per-install
tarball concurrency.

Workbench is physically excluded by its origin Web Lock and sole owner-wide
`PackageAcquisitionAuthority` FIFO (ADR-0278); `InstallStampAuthority` only
serializes trust transitions and is not tree exclusion. A package-local
WeakMap/FIFO would add a competing coordinator and still cannot identify the
same physical VFS across wrappers or realms.

Readiness requires an ADR choosing one transaction authority across VFS
wrappers/realms and consolidating it with the existing Workbench owner. The
contract must settle same-root serialization versus loud pre-mutation
rejection, normalized-cwd aliases, abort/failure release, and preserved
different-root concurrency.
