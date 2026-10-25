---
area: npm-client
status: draft
title: "`npm run <script>` / `npm test` print npm's script banner (`> <pkg>@<ver> <event>`, `> <command>`, blank lines)"
created: 2026-09-24
why: npm prints a blank line, `> <name>@<version> <event>` (or `> <event>` without name/version), `> <command>` and a blank line to stdout before each script step; rifty's shell `npm` prints only `> <command>`, so transcripts and output-comparing tools differ
sources: [docs/public/compat/package-tooling.md]
code: [packages/workbench/src/glue/npm-shell-command.ts]
---

## Context

Discovery of the vitest-run-in-browser acceptance unit (item 12,
`runtime-js/reference/vitest-run-acceptance-evidence.md`) Node oracle — its `npm test`
transcript shows `> test` then `> vitest run`, which rifty lacks; that
unit's contract (branch `vg/u12`) puts the banner out of scope with no
owner.
`runPackageScript` (`npm-shell-command.ts:542`) writes
`` `> ${scriptCommand}\n` `` per pre/main/post step.

Host probe 2026-09-24 (node v24.16.0, npm 11.17.0; `npm test 2>/dev/null
| od -c`):

```
{"scripts":{"test":"echo hi","pretest":"echo pre"}}
  \n> pretest\n> echo pre\n\npre\n\n> test\n> echo hi\n\nhi\n
{"name":"pkg","version":"1.0.0","scripts":{"test":"echo hi"}}
  \n> pkg@1.0.0 test\n> echo hi\n\nhi\n
```

Rifty for the same scripts (code reading): `> echo pre\npre\n> echo
hi\nhi\n`. Compat `docs/public/compat/package-tooling.md` "`npm run
<script>` for non-dev scripts" moved ✅ → ⚠️ with this draft (it did not
mention the banner).

## Next

Owner npm-client (npm CLI surface in the workbench shell). Trigger: a
claimed transcript or tool comparing `npm run` output, or the next npm
CLI unit. Parity first against npm 11.17.0: banner bytes with/without
name/version, pre/post steps, forwarded args (`npm run x -- --y`),
`--silent`/`-s` suppression, and the stream (stdout).
