---
area: shell
status: draft
title: shell git apply finds patch headers like git (skip garbage, reject orphan hunks)
created: 2026-11-17
why: `parseUnifiedPatch` throws on an unknown line git skips and admits an `@@` hunk with no file header git rejects
sources: [docs/backlog/shell/git-builtin-bom-strip-decode.md, docs/public/compat/git.md]
code: [packages/shell/src/commands/git.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17), split from
`git-builtin-bom-strip-decode` (BOM-independent). `git.ts` `parseUnifiedPatch`
has no git `find_header` semantics: an unrecognised line throws
`NotImplementedError('git.apply.format')` (:1775) where git skips leading
garbage (probe: BOM'd `diff --git` patch → git exit 0, falls back to
`---`/`+++`); an orphan `@@` hunk is admitted via `ensureFile` (:1737) where
git exits 128 `patch fragment without header at line N`. Probes: sweep scratch
vs docker git 2.39.5; re-run local git 2.50.1. Fault: corrupt-input (malformed
patch admitted / valid patch refused) at the patch parser. Compat: `git.md`
`apply` :32 ⚠️. Dedup: `git-state-workflows-reflog-conflicts-patches` covers
apply scope, not header search; no other match.

## Next

Owner shell; trigger: `git apply` of mail/garbage-prefixed patches, or the
BOM decode fix (co-landing). RED first: garbage line before `diff --git` →
exit 0 applied; `@@` hunk without `---`/`+++` → exit 128.
