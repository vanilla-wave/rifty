---
area: toolchain-build
status: draft
title: "Parity runner default mode compares rifty's stderr as stdout, and shares process-once state across cases"
created: 2026-11-24
why: in the default (non-seeded) mode rifty's stderr lands in the buffer compared to Node's stdout, and module-level once-per-process state (DEP0169's flag) is shared by every case of the run — a case where rifty correctly warns goes red, depending on case order
sources: [docs/adr/runtime-js/0574-generate-legacy-node-url-and-node-querystring-from-pinned-node-sources.md, tools/node-parity-runner/cases/url/legacy-parse-query.case.ts]
code: [tools/node-parity-runner/src/run-in-rifty.ts, tools/node-parity-runner/src/run-in-node.ts, packages/runtime-js/src/builtins/process-stdio-writer.ts, packages/runtime-js/src/builtins/process-public.ts]
---

## Context

Found by the legacy `node:url` port (ADR-0574), 2026-11-24, before the cases' workaround (rifty then
emitted DEP0169; it no longer does, ADR-0574 §Corrections — the same path carries DEP0170 from
`url.parse('http://a.com:xx/')` and any other rifty warning).
`run-in-rifty.ts:1833-1842`: without a seeded process (`isSeededProcessCase`, :406) both
`writeStdout` and `writeStderr` push to one `captured` array; the Node side (`run-in-node.ts`
~:431) compares stdout only. Chain: `url.parse` from user code → `emitWarning` →
`host.stderr.write` (`process-warnings.ts:154`) → fd 2 of the default process falls back to
`console.error` (`process-stdio-writer.ts:170`) → `captured`. Observed:
`pnpm test:parity url/legacy-parse-query` → `+ (node:1) [DEP0169] …` as a stdout diff (Node also
warns, on stderr). Second, independent: default cases run in the current realm
(`runInRiftyInCurrentRealm`, :2029), whose guest global `process` is the host Node's, while the
url binding emits through `publicNodeProcess()`'s `riftyProcess` fallback
(`process-public.ts`, `url-legacy/bindings.ts`) — a guest `process.noDeprecation` does not reach
it, and the once-per-process flag is set by the first case that calls `url.parse`, so results
depend on case order. Workaround now: `stdin: []` (seeded Worker process) in
`cases/url/legacy-*.case.ts` and `cases/querystring/unescape-override.case.ts`. Possibly older
workarounds of the same gap: `url/file-url-consumers`, `worker_threads/script-entry-contract`,
`worker_threads/parent-event-surface` silence `console.warn` (not checked). Harness gap; product
stderr is covered by isolate-host and browser-unit (`url-legacy` tests).

## Question

Default-mode stderr: compare it to Node's stderr (every default case would then face Node's own
warnings) or keep it out of the compared stream? And per-case process state: a fresh realm per
case, or a seeded process as the default?
