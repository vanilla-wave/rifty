---
area: runtime-js
status: draft
title: Resolve `child_process.spawn('npm' | '<node_modules/.bin/*>')` through the rifty shell instead of ENOENT
created: 2026-09-27
why: guest code that spawns `npm`, `npx` or an installed bin gets `spawn npm ENOENT` (exit 127) although the rifty shell can run exactly those commands; only native binaries are a browser ceiling
sources: [docs/backlog/distribution/reference/no-coi-agent-host-kit-evidence.md]
code: [packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/builtins/child_process-ceiling.test.ts]
---

## Context

Finding (fidelity audit row 11). `child_process.ts:323-325,461-466` maps
every non-`node` command to `spawn <cmd> ENOENT`; `child_process-ceiling.
test.ts` pins it as a ceiling. For `git`, `sh`, native binaries that is
honest. For `npm`, `npx` and `node_modules/.bin/*` scripts the rifty shell
already resolves and runs them (`packages/shell`), so the ENOENT is an
invented gap: Node programs and test runners that `spawn('npm', ['run', …])`
or `execSync('vite build')` fail where Node succeeds. Oracle: real Node 24
resolving the same commands via PATH. Outside the no-COI agent host kit.

## Out of scope

- Native binaries, `sh -c` with shell syntax beyond the rifty shell's grammar (loud).
