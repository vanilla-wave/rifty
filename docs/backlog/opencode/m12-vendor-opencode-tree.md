---
area: opencode
status: active
title: F01 vendor opencode tree (KEYSTONE — unblocks the rest of M12)
created: 2026-06-08
why: keystone gate — Spike C + F03/04/06/07-T1/08 + F02-T9 all gate on the vendored tree; network-gated
sources: [TASKS M12 F01, docs/opencode/README.md §What shipped — F01 vendoring, Q-2026-05-30-101, audit-digest]
---
## Context
opencode is a Bun monorepo (workspace:/catalog: deps) the npm installer cannot parse. F01 = vendor a pinned-SHA snapshot of the 7 server-path packages + a derived npm-installable facade manifest. README reports F01 DONE: pinned SHA `f401f01…` (branch `dev`), `e8be3b2`, 5.6 MB / 911 files, no node_modules committed; `tests/integration/fixtures/opencode/source/` + `facade-manifest.json` + `deps/{package.json,package-lock.json}`; `tools/shadow-registry/scripts/fetch-opencode.mjs` repro. Programmatic entry = `Server` from `server/server.ts`, NEVER `src/node.ts`/`src/index.ts` (bun:sqlite import-time crash). `cd deps && npm ci` → ~217 MB / 327 pkg deterministic.
## Options / Next
Decision taken (Q-2026-05-30-101, provisional): vendor + one-shot pin script generating facade.package.json (catalog:→concrete, drop workspace:, prune to KEEP). Alts rejected: teach npm-client Bun protocols (IRREVERSIBLE); bun install + snapshot; hand-write static JSON. Next: this is the standing reference/keystone — keep the fetch script's pinned-SHA-over-committed-binary contract; re-run is a no-op diff. 4 natives/wasm (@parcel/watcher, @lydell/node-pty, @silvia-odwyer/photon-node, web-tree-sitter) in optionalDependencies, reached by STATIC server-graph imports → degrade, not omit. @ai-sdk/* + @npmcli/arborist are dynamic import() (fetch-on-demand), intentionally outside KEEP.
## Reversibility
REVERSIBLE per Q-2026-05-30-101 (scripts/ + tests/fixtures only, revert = delete fixture dir, rule 5) — but load-bearing as the gate every other M12 item depends on. Q awaits end-of-M12 human review.
