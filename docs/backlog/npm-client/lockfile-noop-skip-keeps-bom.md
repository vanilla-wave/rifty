---
area: npm-client
status: draft
title: Decide whether the no-op lockfile write skip may keep bytes npm's unconditional save rewrites (leading BOM)
created: 2026-11-17
why: rifty npm install leaves a BOM'd package-lock.json byte-identical where npm 11 rewrites it without the BOM, so guest code reading the lockfile sees a BOM npm would have removed
sources: [docs/adr/npm-client/0023-lockfile-reuse.md]
code: [packages/npm-client/src/installer-lockfile-reader.ts, packages/npm-client/src/installer.ts, packages/vfs/src/memory.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17), outside its Node
decode scope. `installer.ts:538` → `writeLockfileIfChanged`
(`installer-lockfile-reader.ts:319`): `vfs.readFileText` strips the BOM
(`memory.ts:19` default `TextDecoder`), so the :328 `current === next` skip
fires (:330 `sameJsonData` likewise) — returns `false`, no write. Rifty probe (tsx, MemoryVfs,
`EF BB BF` + `JSON.stringify(lock,null,2)`): `wrote false first3 efbbbf`.
ADR-0023 `:43`: "On-disk lockfile left byte-identical when no new entry is
pulled." (mtime promise, `packages/npm-client/CHANGELOG.md:793`).

npm: `Shrinkwrap.save` writes unconditionally (`toString` → `writeFile`,
arborist 9.8.0 `lib/shrinkwrap.js:1166-1185`; reify `lib/arborist/reify.js:1838`).
Probe (npm 11.17.0, Node v24.16.0, `npm install --offline` on a no-dep package,
lockfile prefixed `EF BB BF`): "up to date", file now starts `7b 0a`, `cmp` equal
to clean lock. Guest consequence (not probed in rifty):
`JSON.parse('\uFEFF{}')` → `SyntaxError` (Node v24.16.0). Fault (if npm
binds): `lossy-aggregate` — the no-op gate compares decoded text/JSON value,
on which BOM'd and npm-saved bytes collide.
Decoder-dependent: a BOM-keeping `readFileText` makes :330 parse throw → rewrite.
Dedup: `git grep -i 'writeLockfileIfChanged|installer-lockfile-reader|sameJsonData|shrinkwrap|lockfile.*(bom|indent|newline)'`
over docs/backlog, traps.md, ADR README §Declined — no match.

## Question

Keep ADR-0023's byte-identical skip (declare BOM/format divergence, dated
ADR-0023 line per `DEC-2`) or follow npm's always-save (drop mtime promise)?
Open: other npm save normalisations the skip also preserves (indent, EOL, key
order) — not probed. Owner npm-client; trigger: a claimed project whose
lockfile carries a BOM or non-npm formatting.
