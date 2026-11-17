---
area: playground
status: draft
title: Workbench dev-server child stderr is written to the shell's stdout
created: 2026-11-17
why: owner sends a guest dev server's stderr through the same log sink as stdout, wired to ctx.stdout, so `npm run dev > f` captures errors bash keeps on fd 2
sources: [docs/backlog/playground/workbench-output-transport-bom-strip.md]
code: [packages/workbench/src/workers/owner-child-dev-server.ts, packages/workbench/src/workers/workbench-project-runtime.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17); code read @ c1dbce6e2.
`owner-child-dev-server.ts:179-185` — one `writeLog` on both `handle.stdout()`
and `handle.stderr()` → single `opts.log(text)` (`log: (chunk: string)`, :101).
Only boot caller `workbench-project-runtime.ts:238-240` wires
`log: (chunk) => ctx.stdout.write(chunk)`; `ctx` = shell `npm` ctx for
`npm run dev` when the script is `directNodeServerCommand` (:214, :316-328),
which has its own `ctx.stderr` (`project-terminal-namespace.ts:500-501`).
Sibling `run-foreground-child.ts:247-248` keeps two sinks → `sibling-drift`.

Consequence, from code (rifty not run): `npm run dev > log`, entry writes
stderr then exits 1 → redirected stdout is not displayed (`shell.ts:744,767`),
flushed to `log` on non-SIGINT exit (:923): the error lands in `log`, terminal
shows nothing. Without a redirect, `RunResult.stdout` / `onChunk(…, 'stdout')`
carry stderr mislabelled as stdout (:767, :789-795). `2>file` cannot separate
it either: `shell/fd-numbered-redirect-misparse`.

Reference (bash 3.2.57, Node v24.16.0, npm 11.17.0, scratch
/tmp/devsrv-stderr-probe; `s.js` = `console.log('O'); console.error('E')`,
script `"dev": "node s.js"`): `npm run dev --silent > f2; od -An -c f2` →
terminal `E`, file `O \n`. stderr stays fd 2.
`2>/dev/null` is not a consequence here: rifty lexes `npm run dev 2>/dev/null`
as word `2` + `>` + `/dev/null` (tsx probe of `tokenize.ts`; ops `:50`) — no
fd-2 redirect exists; nearest `terminal/reference/review-2026-06-07.md:17`
(`2>&1` only).
Dedup: git grep docs/backlog, traps.md, ADR §Declined for
`owner-child-dev-server`, `writeLog`, `stderr` merge/on stdout, `dev-server`
stderr, `2>`, fd-dup; no match (`foreground-child-post-spawn-rollback` names the
file, covers rollback only).

## Next

Owner playground (workbench workers); trigger: a guest dev server whose
stderr is redirected, piped or read by an embedder. RED first:
`owner-child-dev-server.test.ts` fake handle emits stderr `E\n` → reaches a
stderr sink, not `log`/ctx.stdout; open: split `log` into stdout/stderr sinks
or pass ctx through — decide at pickup.
