---
area: shell
status: ready
title: npx executes installed local binaries through the existing Node executor
created: 2026-10-20
why: goal commands npx esbuild and npx vite currently exit 127 before invoking installed binaries
epic: esbuild-upstream-twin
sources: [ADR-0545, docs/backlog/shell/npx-and-package-manager-nudge-honesty.md]
code: [packages/shell/src/shell.ts, packages/shell/src/command-resolver.ts]
---

## Context

Required local-execution half of the existing nudge draft. This unit adds no
network acquisition; full esbuild/Vite scenarios remain in cutover.

## Challenge

challenge: 2026-10-20 — clear; reuse bin lookup/executor, no second execution owner.
Native npx executes a real installed Acorn CLI; direct Chromium invocation
works while npx fails. Initial esbuild-wasm preflight exposed the independent
acquisition-bin suppression, so it was not accepted as this unit's RED.

## Acceptance

1. Bare npx and npx --no-install run an installed local bin from root/nested
   cwd, preserving arguments and output against native npx. → I2
2. Selection uses local/ancestor .bin, never substitutes a registered builtin;
   same context/executor owns child completion and cancellation. → I2
3. Unsupported acquisition/spec/options/interactive cases throw the ADR-0545
   named gaps; installed-bin execution performs no registry acquisition. → I2
4. Lookup has no package/version gate; installed Vite uses the same route. → I6

## Reference contract

Node v24.16.0 bundled npx. Real acorn@8.15.0 archive (fixture only, no admission
pin). `local-npx.spec.ts` compares help and parsing from nested cwd; direct
bin preflight passes, npx exits 127 / returns the package-manager nudge.
`npx-refusals.test.ts` covers declared unavailable modes, not Node success.

## Out of scope

Remote acquisition, package-spec inference, other npm exec options and an
interactive npm exec shell remain named gaps. Existing manager-nudge draft
retains their availability wording and yarn/pnpm/bun scope.

## Decisions

- ready-verdict: 2026-10-20 — Contract+RED @ 9bc660fd183db2f979db244a0e8aa8266cd175f3
- 2026-10-20 — ADR-0545; existing command resolver and BinExecutor retain ownership.
