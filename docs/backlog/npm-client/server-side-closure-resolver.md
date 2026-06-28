---
area: npm-client
status: draft
title: Server-side full-closure resolver
created: 2026-06-28
why: the only lever that collapses the metadata waterfall from O(graph-depth) round-trips to O(1) — but it duplicates rifty's resolution algorithm server-side and adds always-on infra
user_story: As a developer on a deep dependency graph, I want the whole resolved closure in one round-trip, but today the client discovers transitive deps level-by-level, paying one RTT per graph level.
epic: cold-npm-install-speedup
blocked_by: [perf/cold-install-metadata-reprofile]
sources: [https://medium.com/stackblitz-blog/introducing-turbo-5x-faster-than-yarn-npm-and-runs-natively-in-browser-cc2c39715403, https://docs.deps.dev/api/v3/]
code: [packages/npm-client/src/installer.ts, deploy/yandex/npm-registry/Caddyfile]
---

## Context

The waterfall floor is graph DEPTH × RTT: a grandchild's name is unknown until its parent's metadata resolves (confirmed by `walkAndPin` recursing over `pin.dependencies`, known only post-resolve). A resolver co-located with the registry metadata walks every inter-level edge at memory speed and returns the full pinned closure (name / version / integrity / tarball) in ONE client→server RTT. The client keeps `walkAndPin` as the layout authority — its serial `await source.resolve` consumes the pre-fetched closure like an ideal prefetch; `choosePlacement` / first-wins-flat are untouched, so the determinism invariant holds. A KB-scale closure dodges the 2.5-3.5 MB serverless response limit that killed the serverless packument proxy (ADR-0163).

## Open forks (resolve to reach ready — ADR required)

- IRREVERSIBLE: a new server-side component + a second copy of the resolution algorithm → an ADR extending ADR-0163 lands BEFORE `ready`, not at pickup.
- Fidelity risk = lockstep drift: the server closure MUST equal the client closure or it silently builds the wrong tree. Gate: a byte-for-byte server==client parity harness on express@^4 + eslint@^9 passes before any infra ADR.
- Prototype offline FIRST (no infra): build the closure in-process behind a `ResolutionSource`, prove parity + measure real closure payload size (confirm KB << 2.5-3.5 MB).
- Reject third-party resolvers: deps.dev (~99% coverage = silent-wrong-tree risk), JSPM / esm.sh (return transformed modules, not real npm tarballs), and any hardcoded external resolver URL violates D-004.
