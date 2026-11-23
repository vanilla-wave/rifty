---
area: runtime-js
status: draft
title: Decide whether embedder sandbox.fs readFile(path, 'utf8') keeps a leading UTF-8 BOM
created: 2026-11-17
why: host SDK utf8 read drops EF BB BF, so an embedder readFile→writeFile round trip silently deletes the BOM from the file
sources: [docs/adr/toolchain-build/0131-public-sandbox-filesystem-api-for-ai-agents.md, docs/backlog/distribution/reference/ai-agent-core-evidence.md]
code: [packages/runtime-js/src/worker-fs-rpc.ts, packages/runtime-js/src/host-fs.ts, packages/workbench/src/workers/no-coi-toolchain-owner.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17); host SDK, not guest
code, so outside that fix. `worker-fs-rpc.ts:19` `new TextDecoder()` (default
`ignoreBOM: false`) decodes `readFile(path, 'utf8')` at `:37`; `writeFile`
string re-encodes via `TextEncoder` (`:62`). Callers: `worker-entry.ts:282`
(`HostMessage 'fs'`), `no-coi-toolchain-owner.ts:339` (`project-fs`), surfaced
as `RuntimeFs` (`host-fs.ts:15`) / `sandbox.fs` (`rifty/src/sandbox-fs.ts`).
Siblings keep it: guest `fs`/io decode now `ignoreBOM: true`; `@riftydev/agent`
reads bytes + own `ignoreBOM: true` decoder (`agent/src/sandbox-host.ts:3`).

Probe (Node v24.16.0, file `EF BB BF 68 69`): `fs.promises.readFile(f,'utf8')`
→ len 3, first `feff`; `new TextDecoder().decode` → len 2, re-encoded `68 69`.
ADR-0131 mirrors Node's signature; `:51` reads "- No compat-matrix regen: no
Node/runtime conformance claim changed." and no line names a decode oracle. Fault: `sibling-drift` (utf8 decode semantics
across decode sites) → data loss on round trip.
Dedup: `git grep -i 'bom|worker-fs-rpc|sandbox-fs|sandbox\.fs|ignoreBOM'` over
docs/backlog, traps.md, ADR README §Declined — no match (agent BOM evidence
covers agent decoders only).

## Question

Keep (Node-shaped, `ignoreBOM: true`, dated ADR-0131 line per `DEC-2`) or strip
(declare it in ADR-0131 + `RuntimeFs` doc)? Owner runtime-js; trigger: an
embedder/editor round-trips a BOM file via `sandbox.fs`.
