---
area: npm-client
status: draft
title: Tar unpacker keeps a leading UTF-8 BOM in member names, as npm's node-tar
created: 2026-11-17
why: rifty decodes tar names with a BOM-stripping TextDecoder; npm keeps U+FEFF, so a crafted tarball installs at a different path or is rejected where npm extracts it
sources: [packages/npm-client/src/_test-fixtures/types-react-19.3.0/README.md]
code: [packages/npm-client/src/unpacker.ts, packages/npm-client/src/eddy-bundle-stream.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17), outside its Node
decode scope. `unpacker.ts` decodes names with default `TextDecoder('utf-8')`:
`parseTarHeader` :50 (ustar `name` and `prefix`, each one-shot via
`readString`), `parseTar` :60/:76 (GNU `L` long name). npm 11.17.0 bundles tar
7.5.16: `header.js` `decString` = `buf.toString('utf8')`, long path via Buffer
toString; BOM kept, strip:1 runs after decode.

Probe (Node v24.16.0, npm 11.17.0 `pacote.extract` 21.5.1 vs rifty
`extractTarGz`; crafted tgz + `package/package.json`):
- ustar prefix `package/dir` + name `EF BB BF a.js` → npm `dir/\ufeffa.js`,
  rifty `dir/a.js`.
- GNU long name `\ufeff../x` → npm `x`, rifty throws `EINVALIDPACKAGETAR`
  (`extractTarGz` :143-145).
Reach: `npm install` → node_modules paths seen by guest fs/require; crafted
tarballs only. Eddy bundles share `parseTarHeader`, rifty-made names only.
Fault: corrupt-input (lossy name decode) at the registry tarball boundary.
Also seen, not this item: `prefix` read without ustar-magic check or 130/155
split (node-tar `header.js` :135, :156-163).
Dedup: git grep `bom|feff|ustar|long.name|unpacker` over docs/backlog,
traps.md, ADR §Declined: only `tar-symlink-and-nonregistry-dep-tracking`
(symlink typeflag, other mechanism).

## Next

Owner npm-client; trigger (low): a real tarball with a BOM-led member name, or
the next `unpacker.ts` name-decode change. RED first: both probe archives as
npm-captured rows in `unpacker-npm-root.test.ts` beside `path-variants.json`
(`tar-builder.ts` needs prefix + `L` support).
