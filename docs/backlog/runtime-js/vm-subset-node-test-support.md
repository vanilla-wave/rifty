---
area: runtime-js
status: active
title: Minimal node:vm subset + node:test built-in runner
created: 2026-06-11
why: node:vm is a loud-throw stub and node:test is unregistered, so config loaders (jiti/cosmiconfig-style), template engines, and a package's own node:test suite can't run — all pure-JS, no browser ceiling
sources: [M11, docs/research/open-webcontainers-alternative-2026-06.md]
code: [packages/runtime-js/src/builtins/misc-stubs.ts, packages/runtime-js/src/builtins/index.ts]
---

## Context

`node:vm` is a loud `loudProxy` (misc-stubs.ts; registered in index.ts); `node:test` is not
registered at all. The runtime already executes modules via `new Function`, so a useful `vm` subset
(`runInThisContext`/`runInNewContext`/`compileFunction` + `Script`, with a sandbox-global proxy) is
low-risk — it just can't be a truly isolated context (document the shared-globals fidelity limit
honestly). Registering `node:test` (`test`/`describe`/`it`/`mock`/`TestContext` + a spec reporter)
lets packages run their own suites in-runtime — a strong correctness/credibility proof point, pure
JS. On the M11 "runs real-ish projects" theme.

## Options or Next

- `vm`: `runInThisContext`/`runInNewContext`/`compileFunction`/`Script` via `new Function` + sandbox
  proxy; document the no-true-isolation limit.
- `node:test`: register `test`/`describe`/`it`/`mock`/`TestContext` + reporter.
- (Separate, already noted) regenerate the stale `docs/public/compat/modules.md`.

## Reversibility

REVERSIBLE — additive builtins; the `vm` fidelity limit is documented, not pretended. Recorded here.
