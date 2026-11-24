---
area: toolchain-build
status: draft
title: "Parity runner default mode compares rifty's stderr as stdout"
created: 2026-11-24
why: in the default (non-seeded) mode `run-in-rifty.ts` pushes rifty's `console.error`/`warn` output into the same buffer as stdout, while the Node side compares stdout only — a case where rifty correctly writes stderr (a deprecation warning) goes red
sources: [docs/adr/runtime-js/0574-generate-legacy-node-url-and-node-querystring-from-pinned-node-sources.md]
code: [tools/node-parity-runner/src/run-in-rifty.ts]
---

## Context

Found by the legacy `node:url` port (ADR-0574, 2026-11-24). `run-in-rifty.ts` (≈ line 1830):
without a seeded process both `writeStdout` and `writeStderr` push to one `captured` array;
the Node child's stderr is not compared. With the port, `url.parse` from user code emits DEP0169
(Node too, on stderr): `pnpm test:parity url/legacy-parse-query` showed `+ (node:1) [DEP0169] …`
as a stdout diff. In this lane the guest's `process` is the host's, so `process.noDeprecation`
does not reach rifty's process, and the once-per-process warning flag is shared by every case
of the run (only the first case to call `url.parse` warns: results depend on case order).
Workaround in the cases: `stdin: []` (seeded process: its own stderr, `noDeprecation` works).
Harness gap, not a product defect; product stderr is covered by isolate-host and browser-unit.

## Next

Owner toolchain-build (parity runner). Trigger: the next default-mode case that writes stderr.
First step: route `writeStderr` to its own buffer (compared to Node's stderr or dropped, as the
Node side does) with a runner self-test row.
