---
area: runtime-js
status: ready
title: Link ESM named imports of implemented node:process methods
created: 2026-09-15
why: Node exposes process methods as own enumerable properties, but NodeProcess keeps them on its prototype; the builtin ESM namespace then lacks cwd and tinyexec fails at link time
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md]
code: [packages/runtime-js/src/module-loader/cjs-interop-authority.ts, packages/runtime-js/src/builtins/process.ts]
---

## Context

The loader derives builtin ESM names from `Object.keys(module.exports)`. Real
Node exposes `cwd`, `chdir`, `hrtime`, `uptime`, `exit`, and `kill` as own
enumerable process properties. Rifty's same methods sit on `NodeProcess.prototype`.
Scanning every prototype member would also expose runtime-only `pushStdin` and
EventEmitter methods that Node does not export.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)

## User scenario

After installing the goal's exact Vitest/Vite pair, `tinyexec` imports
`{ cwd }` from `node:process` while `vitest run` loads. The import links and
`cwd()` reads the same process as the default `node:process` export.

## Reference contract

Node v24.16.0: its `node:process` ESM namespace has the six method names above,
each value is the identical own enumerable property on its default process;
`pushStdin`, `on`, and `emit` are absent. Command and output:
`docs/backlog/runtime-js/reference/builtin-static-names-prototype-methods-evidence.md`.

## Acceptance

1. Static ESM `import { cwd } from 'node:process'` links, equals the default process's `cwd`, and invokes it; no package-specific patch. → I6
2. Other existing NodeProcess methods exported by Node (`chdir`, `hrtime`, `uptime`, `exit`, `kill`) have the same named/default identity; runtime-only `pushStdin` and inherited EventEmitter methods do not become named exports. → I6

## Parity cases

1. `process/named-method-exports.case.ts`: real Node and rifty both link the six names; own/enumerable shape, named/default identity, callable `cwd`, `hrtime.bigint`, and absent internal names match. → I6

## Out of scope

- `process.exit()` code and lifecycle events: `runtime-js/process-lifecycle-events-exit-code`.
- Missing process members such as `memoryUsage`: `runtime-js/absent-builtin-members-loud-throws`.
- Arbitrary prototype members as builtin ESM exports: Node excludes inherited and host-only methods; unsupported imports stay loud link errors.

## Decisions

- 2026-09-23 — Re-cut the generic prototype scan to Node's own process shape; it meets I6 without exposing host methods.
