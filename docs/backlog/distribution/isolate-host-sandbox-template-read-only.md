---
area: distribution
status: draft
title: A sandbox over a template can be read-only — writes under /node_modules fail EROFS as on a read-only mount
created: 2026-11-25
why: The user asked for both modes («Я бы на самом деле поддержал оба варианта, чтобы можно было выбирать»); the template goal ships writable only and refuses a read-only option as unknown (`ERR_INVALID_ARG_VALUE`, compat ❌) — the user moved it here (2026-11-25).
sources: [docs/backlog/distribution/reference/isolate-host-sandbox-template-probes/README.md, ADR-0572, PR-429-review]
code: [packages/isolate-host/src/sandbox.ts, packages/vfs/src/memory-backend.ts, packages/workbench/src/workers/no-coi-project-fs.ts]
---

## Context

User, 2026-11-24 (template refine, F2): «Я бы на самом деле поддержал оба варианта, чтобы можно было
выбирать…» (writable and read-only, per sandbox — the agent's reading of «выбирать»). User,
2026-11-25: «ок» to the manager's «Б — в backlog, пока не понадобится потребителю. До тех пор опция
отклоняется как неизвестная. Рекомендую Б.» Until this lands a read-only option of `createSandbox`
is an unknown option (`ERR_INVALID_ARG_VALUE`), compat ❌.

Cost (re-estimated 2026-11-25 after the manager's review S11): the mechanism is small — `EROFS` and
its Node shape exist (`vfs/src/types.ts`, `runtime-js/src/builtins/fs-errors.ts`, errno −30); both
guest FS surfaces sit on one `MemoryBackend` (`createMemoryFs`), so a refusal by the `/node_modules`
prefix on the backend's mutators is one choke point (pattern: `no-coi-project-fs.ts` `writable()`
with its destructive-ancestor rule), plus the host ops — ~100–150 lines. The cost is the order of
errors and calls through an ancestor:

- (a) full parity with a Linux read-only mount: oracle Node v24.16.0 on a `mount -o ro` tmpfs (a
  GitHub runner, sudo); table of every mutating call in sync / callback / promise / stream form,
  `open` flags `w`/`a`/`r+`, `truncate`/`utimes`; error precedence (`EEXIST`/`ENOENT`/`ENOTDIR`
  vs `EROFS`); partial `rm -rf /`, `cpSync` onto `/`, a rename across the mount boundary — ~1 PR
  (~150 mechanism, ~100 ordering, ~200 oracle harness, ~300 tests); partial deletions through an
  ancestor need the walk order of Linux.
- (b) `EROFS` by a pinned table recorded once from Linux (command, output, kernel version); calls
  through an ancestor (`rm -rf /`, `cpSync` onto `/`) refused whole before any write, a declared ⚠️
  against Linux — about half of (a). The agent's recommendation.

Owner: distribution (isolate host). Trigger: a consumer needs a read-only template.

## Challenge

challenge: 2026-11-25 — none yet (user-deferred capture)
