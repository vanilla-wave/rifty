---
area: shell
status: draft
title: rifty git strips a leading UTF-8 BOM decoding repo and patch bytes, and its apply parser lacks git's header search
created: 2026-11-17
why: shell git drops a leading UTF-8 BOM in show/config/diff/apply and admits BOM'd patches git rejects, so stdout and rewritten files differ from real git
sources: [ADR-0167, docs/adr/runtime-js/0069-readable-set-encoding.md, docs/backlog/shell/git-command-isomorphic.md, docs/public/compat/git.md]
code: [packages/git/src/fs-adapter.ts, packages/git/src/git.ts, packages/shell/src/commands/git.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17), outside its io/runtime-js scope.
Default `new TextDecoder()` strips leading `EF BB BF` at:

- `git/src/fs-adapter.ts:112` — iso-git `fs.promises.readFile(p,'utf8')` emulation (Node keeps BOM). BOM'd `.git/config` + `git config foo.bar baz` → rifty file starts `5b636f72655d0a09`, real git keeps `efbbbf5b636f7265`. Same read-modify-write: packed-refs, stash reflog append.
- `shell/src/commands/git.ts:1102` — `git show HEAD:f.txt` → rifty `6c696e6531…`, real git `efbbbf6c696e6531…`; non-UTF-8 blob → U+FFFD.
- `git/src/git.ts:337`/`:406` → `lineDiff` — BOM-only change → `modify` with `hunks: []` (`git diff` prints headers, no `@@`); BOM in both versions → context ` line1` (BOM lost). Real git: `-\357\273\277line1` / `+line1`, context keeps BOM.
- `shell/src/commands/git.ts:1856` `planApply` — patch with git-emitted context ` \uFEFFline1` → rifty exit 1 `patch does not apply`, git applies; hunk off line 1 applies but write-back drops file BOM.
- `shell/src/commands/git.ts:1938`/`:1955` patch file/stdin — BOM'd traditional patch (`---`/`+++`/`@@`, no `diff --git`) → rifty exit 0 applies; git exit 128 `patch fragment without header at line 3`. Parser half, not decode (strip only masks it): `parseUnifiedPatch` lacks git `find_header` semantics — unknown line → throw (:1775), git skips garbage (probed: BOM'd `diff --git` patch exit 0); orphan `@@` admitted via `ensureFile` (:1737), git fails.

Probes: sweep scratch (real shell builtin + Memory VFS) vs docker git 2.39.5; show/config/diff re-run local git 2.50.1 (Apple Git-155), same bytes.
Parse side safe with BOM kept: GitConfig `trim` eats U+FEFF; ignore@5.3.2 strips `^\uFEFF` (= real git check-ignore); BOM'd HEAD fails in real git too.
Fault: corrupt-input (bytes dropped on output/write-back; malformed patch admitted) + lossy-aggregate (`lineDiff` collides BOM/no-BOM) at the git decode boundary.
Compat: `docs/public/compat/git.md` rows `diff` :19 ⚠️ ("NOT byte-exact"), `show` :27 ⚠️ (blob form "prints bytes" — contradicted by :1102), `apply` :32 ⚠️ / `config` :34 ⚠️ (BOM unnamed).
Dedup: searched docs/backlog, traps.md, ADR §Declined for bom/FEFF/TextDecoder/git show/apply/lineDiff/fs-adapter — no match. Nearest: `git-state-workflows-reflog-conflicts-patches` (apply scope, no decode), `byte-exact-command-output` (head/tail U+FFFD).

Also (sweep critic, code read): iso-git `mergeFile` (isomorphic-git@1.38.5
`index.js:8087-8123`) decodes with the global Buffer = io's, so since the
2026-11-17 io fix a 3-way merge keeps the BOM (git 2.50.1 probe: merged head
`efbbbf41310a`) — no regression case yet; with `core.autocrlf=true`
(`index.js:5070` fatal TextDecoder) `git add` stores the blob without the BOM
(git: `efbbbf610a`, iso-git `610a`).

## Next

Owner shell (`packages/git` + shell git builtin); trigger: next git byte-fidelity or `git apply` work, or a user BOM'd-repo report.
RED first: BOM'd `.git/config` + `git config foo.bar baz` keeps `efbbbf`; `git show HEAD:f.txt` emits `efbbbf…`; BOM-only edit → `git diff` has `@@ -1,3 +1,3 @@`.
Parser half lands with the :1938/:1955 decode: `ignoreBOM: true` alone regresses BOM'd git-format patches (git exit 0, falls back to `---`/`+++`) to `NotImplementedError('git.apply.format')` (:1775). RED: BOM'd traditional patch → exit 128 `patch fragment without header`; BOM'd git-format patch → exit 0, applied.
