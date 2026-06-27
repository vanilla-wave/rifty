---
area: runtime-js
status: draft
title: fs.glob/globSync/promises.glob + path.matchesGlob (full minimatch)
created: 2026-06-21
why: Node v24's glob is a FULL minimatch engine (brace/extglob/negation/globstar); a */**/?/[..] subset would loud-throw on the most COMMON pattern (brace {js,ts}) → noisy/near-useless, so it was split out of fs-path-pure-js-completions (which shipped F1-F6) rather than ship a half-engine.
user_story: As a dev running a bundler/build tool, I want fs.globSync('**/*.{js,ts}') + path.matchesGlob, but today they're undefined so the tool throws.
sources: [docs/research/node-parity-gaps-unbacklogged-2026-06-20.md §1, ADR-0050 (no-symlink)]
code: [packages/runtime-js/src/builtins/fs.ts, packages/runtime-js/src/builtins/path.ts, packages/shell/src/commands/_glob.ts]
---

## Context

Split from `fs-path-pure-js-completions` (F1-F6 shipped: recursive readdir+parentPath, cp edge-opts, openAsBlob, toNamespacedPath, lutimes, futimes). `fs.readdirSync({recursive})` already lands the breadth-first full-tree walk (`fs.ts`) that the glob matcher walks over — the ready substrate. NO `fs.glob`/`globSync`/`promises.glob` in fs.ts; NO `matchesGlob` in path.ts (RED). The only repo glob matcher is `packages/shell/src/commands/_glob.ts` (`matchSegment`) — SINGLE-SEGMENT only (no `**`, no braces) AND in the shell layer ABOVE runtime-js (arch-rules forbid importing it). A shared matcher would need extracting to a lower layer (io/vfs).

Node v24 oracle (RUN, real Node, tree proj/{index.js, readme.txt, src/{a.js,b.js,c.ts}, test/a.test.js}):
- `globSync('**/*.js')` → `["index.js","src/a.js","src/b.js","test/a.test.js"]` (** matches zero dirs → top-level index.js)
- `globSync('*.txt')` → `["readme.txt"]`; `globSync('src/?.js')` → `["src/a.js","src/b.js"]`; `globSync('src/[ab].js')` → `["src/a.js","src/b.js"]`; `src/[!a].js` → `["src/b.js"]`
- `globSync('src/*.{js,ts}')` → `["src/a.js","src/b.js","src/c.ts"]` (brace — COMMON); `src/@(a|b).js` → `["src/a.js","src/b.js"]` (extglob)
- `path.matchesGlob('a/b.js','**/*.js')` → true; `('a/b.js','*.js')` → false; `('a.js','[ab].js')` → true (matchesGlob does NOT normalize a leading `./`)

## Options or Next

Parity-first, full minimatch (NOT a subset): brace `{js,ts}` + ranges `{a..b}`, extglob `@()/+()/!()/?()/*()`, `^`/`!` negation, `**` globstar with Node's subtle edges (zero-dir match, `src/**` includes `src` itself), `exclude`/`cwd`/`withFileTypes`, async-iterator `promises.glob`. Over the existing `readdirSync({recursive})` BFS walk. Effort L, fidelity-MED — pin every oracle above vs parity, and throw a directed `NotImplementedError` on any Node-supported edge left unimplemented (no silent mis-match). Consider extracting the matcher to a lower layer so `shell/glob-expansion` can share it.

## Reversibility

REVERSIBLE — recorded here.
