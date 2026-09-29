---
area: toolchain-build
status: draft
title: "Parity runner `child-worker` programs route a child's `console` through the rifty kernel stdout, not the host's"
created: 2026-09-25
why: in the parity runner's `child-worker` kind a program child's `console.log` reaches the host Node stdout instead of the kernel stdout port, so program parity never observes rifty's console routing (cases must use `process.stdout.write`)
sources: [docs/backlog/runtime-js/reference/worker-threads-stdio-streams-empty-exec-argv-evidence.md, docs/backlog/runtime-js/reference/worker-threads-stdio-streams-empty-exec-argv-final-green.json]
code: [tools/node-parity-runner/src/run-in-rifty.ts, tools/node-parity-runner/src/types.ts]
---

## Context

REV-12 discovery of `runtime-js/reference/worker-threads-stdio-streams-empty-exec-argv-evidence.md`
(vitest-run-in-browser item 11, evidence §Discoveries). Its `vitest-pool-shape`
child probe (`pool-probe.mjs`) had to switch from `console.log` to
`process.stdout.write`: under `kind: 'child-worker'` the child's `console.log`
went to the host stdout, not the kernel stdout port the case reads. Harness
gap (oracle machinery), not a product defect: it hides console routing from
program parity. Product console routing is covered by browser-unit/e2e.

## Next

Owner toolchain-build (parity runner). Trigger: the next parity case needing a
child's `console` output. First step: locate where the `child-worker` program
path installs the child's console (`run-in-rifty.ts` swaps the host `console`
methods) and a runner self-test row showing a child `console.log` on the
kernel stdout.
