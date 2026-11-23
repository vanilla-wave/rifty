---
area: runtime-js
status: draft
title: "In the COI Workbench `child_process.spawn('node', ['-e', code])` runs `code` as Node does"
created: 2026-11-23
why: "A spawned `node -e` loads `-e` as its entry module (`Cannot find module '<cwd>/-e'`); Node evaluates the code"
sources: [tests/browser-unit/node-file-parity.spec.ts, docs/public/compat/process.md]
code: [packages/runtime-js/src/builtins/child_process.ts, packages/kernel/src]
---

## Context

Found 2026-11-23 while pinning row `eval-stack-getter-second-read` (PR #425) on
the COI carrier: its runner `spawn('node', ['-e', "require('./main.js')"], {
cwd })` (also with `process.execPath`) prints `Error: Cannot find module
'<cwd>/-e'` with `code: 'MODULE_NOT_FOUND'`, `requireStack: []`, status 1; the
same line typed in the shell (`node -e "require('./main.js')"`) runs. The
carrier runs such rows through the shell instead. Not probed on the no-COI SDK
or for other flags (`-p`, `--input-type`). Fault class `sibling-drift`
between the shell's `node` entry parsing and the spawn path.

Owner: runtime-js (child_process) with kernel. Trigger: a tool that spawns
`node -e`/`-p` (test runners, CLIs probing the runtime), or the next change to
the spawn entry resolution.

## Challenge

challenge: 2026-11-23 — finding capture; no premise critic (README §Challenge)
