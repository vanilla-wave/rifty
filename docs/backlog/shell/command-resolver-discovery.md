---
area: shell
status: ready
title: Unified command resolver and discovery interface
created: 2026-06-25
why: Running a command, `which`, completion, suggestions, direct path commands, and `.bin` lookup currently cross different seams and can disagree.
user_story: As a developer after installing a package or creating a script in the workspace, I want `vite`, `./node_modules/.bin/vite`, `./scripts/tool`, `which`, and completion to resolve consistently, but today those paths are split across shell execution, bin resolution, and language-service command names.
sources: [ADR-0104, ADR-0137, ADR-0362, docs/backlog/shell/reference/command-resolver-discovery-bash-3.2.57.md, docs/public/compat/package-tooling.md]
code: [packages/shell/src/shell.ts, packages/shell/src/bin-resolver.ts, packages/shell/src/builtins.ts, packages/shell/src/language-service.ts, packages/workbench/src/glue/pty-protocol.ts, packages/workbench/src/workers/pty-server.ts, apps/playground/src/adapters/playground-app.tsx]
---

## User scenario

In a browser project containing an installed `vite` shim and
`scripts/tool.mjs`, a developer can run `vite`,
`./node_modules/.bin/vite`, and `./scripts/tool.mjs`; `which` and terminal Tab
completion report the same live owner state after `cd` or an install. A typo of
an installed command suggests that installed name. Today direct paths miss,
completion is unwired, and the four consumers use separate inventories.

## Reference contract

- Shell selection/error reference: frozen GNU bash 3.2.57 capture at
  `docs/backlog/shell/reference/command-resolver-discovery-bash-3.2.57.md`.
- Bare `.bin` precedence and supervised execution: ADR-0137/0150.
- Terminal/host intelligence seam: ADR-0104.
- Rifty's no-mode direct Node-entry decision and owner completion carrier:
  ADR-0362.

## Acceptance

1. One internal resolver owns registered-command, direct-path, nearest `.bin`,
   and typed-miss results plus sorted/deduplicated command discovery.
2. `Shell.run`, `which`, `hasCommand`, `commandNames`, typo suggestions, and
   `Shell.complete` query that resolver against live cwd and the instance VFS.
   Registered commands keep ADR-0137 precedence.
3. A relative or absolute regular VFS file runs through the existing executor
   with its normalized absolute path and argv. `.bin` entries launch as shims;
   other direct files launch as ordinary Node entries. The owner-child path is
   browser-proven, not replaced by a fake executor acceptance.
4. Direct missing path emits `No such file or directory`/127; ENOTDIR and a
   directory emit their directed diagnostic/126; a found entry without an
   executor remains 126. Bare misses retain `command not found`/127 and package
   manager nudges.
5. Owner-backed Tab completion reaches the owning session Shell over one finite
   correlated PTY request. Bare completion includes installed ancestor `.bin`
   names; path-like argv-0 completes live VFS paths. Cwd/install changes are
   visible on the next request, without a page-side inventory.
6. Completion timeout, owner death/close, malformed/cross-correlated response,
   and owner read failure cannot hang or publish a stale result. Playground
   reports the failure visibly and shows no fabricated menu.

## Parity cases

1. `packages/shell/tests/command-resolver-discovery.test.ts` RED: explicit relative and
   absolute files execute; direct missing/directory/ENOTDIR statuses and
   diagnostics match the frozen bash classes; a path-like miss never falls back
   to a same-named `.bin`.
2. Same suite: builtin/custom shadowing, live cwd, nearest ancestor `.bin`, and
   `which` spelling remain green while all consumers route through one result;
   installed names enter discovery/suggestions/completion but never the
   registered-only `help` synopsis.
3. `packages/shell/tests/language-service.test.ts` RED: a real Shell discovers
   installed ancestor shims, suggests them, and completes bare/direct argv-0
   from its live Memory VFS after cwd changes.
4. PTY client/server tests RED: exact `sid/opId` correlation, two inverted
   replies, error/timeout/disconnect/close settlement, strict frame validation,
   and owner-live cwd/VFS result.
5. `tests/browser-unit/owner-shell-routing.spec.ts` RED: a direct workspace
   script runs in the real owner supervised child as `bin:false`, while an
   explicitly addressed `.bin` launcher runs its target as `bin:true`.
6. Chromium terminal acceptance RED: typing an installed bare prefix and a
   direct path prefix opens the real DOM completion menu; selecting the direct
   entry runs it and records exit 0.
7. `tests/browser-unit/terminal-completion.spec.ts` RED: an edit superseding an
   inflight request drops its late menu; a rejected request renders
   `Completion failed` and no menu.

## Fault matrix

| Boundary × operation | Fault axis | Honest outcome / test target |
|---|---|---|
| page→owner completion request | peer death / port close / finite-ACK timeout | `pty-client.test.ts` settles the request; `terminal-completion.spec.ts` shows `Completion failed` and no menu |
| completion `sid/opId` result | concurrent-same-key / observable-order | `pty-client.test.ts`: inverted/wrong-sid replies settle only matching calls; `terminal-completion.spec.ts` drops a reply superseded by edit |
| PTY completion frame | corrupt-input | `pty-server.test.ts`: strict inspectors reject extra/missing/wrong-shaped fields before dispatch |
| owner resolver VFS discovery | quota-perm-fail / provenance-lie | `pty-server.test.ts`: exact readdir error becomes failure result; no empty-success inventory |
| execution/discovery/which/suggestion siblings | sibling-drift | `command-resolver-discovery.test.ts`: one result projects consistently; no caller-owned precedence copy |

## Out of scope

- Native host PATH/process execution: absent VFS `/bin/echo` is a direct-path
  miss, never a host fallback. Compat remains ❌.
- POSIX execute bits, native/WASI shebang dispatch, symlink permissions: the VFS
  has no mode authority. Direct regular files use the existing Node-entry
  loader; unsupported bytes fail loudly there. Compat remains ❌.
- `which -a/-s`, shell aliases/functions, arbitrary PATH configuration, and
  completion after unsupported grammar stay their existing named
  `NotImplementedError`/compat ❌ surfaces.
- Command descriptors/flag metadata remain
  `docs/backlog/shell/command-manifest-registry.md`; no speculative registry is
  added here.

## Decisions

- `checkpoint-lineage: [c3d83ef02d5e92db14d61aa7f010073f619add4f]`.
- Contract+RED @ `c3d83ef02d5e92db14d61aa7f010073f619add4f`
  BLOCKED: add real-owner explicit `.bin`, registered-only help, visible
  completion failure, wrong-sid and stale-edit fences, reconcile the old
  slash-miss test, and pin directory/ENOTDIR exact diagnostics. Attempt 2
  re-cuts those carriers in place without changing scope or production code.
- ADR-0362 settles direct regular-file semantics, the internal two-method
  resolver, and the owner-backed completion carrier.
- The resolver is internal; no exported resolver type or external adapter seam.
- `help` lists registered synopsis-bearing commands only. `commandNames` is the
  runnable bare-name discovery surface and therefore includes ancestor `.bin`
  files.
- Existing PTY correlation/timeout/disconnect and TerminalPanel stale-request
  sequence are reused; no new queue, epoch, cache, or lock.

## Contract+RED artifacts

Node `v24.16.0`, pnpm `11.5.2`, Vitest `2.1.9`, Chromium from the repository's
Playwright install. Captured 2026-08-23 before production changes.

- `pnpm vitest run packages/shell/tests/command-resolver-discovery.test.ts
  packages/shell/tests/language-service.test.ts` → `13 failed | 12 passed`.
  Direct file receives 127/`command not found`; installed bins are absent from
  `commandNames`/suggestions/completion.
- `pnpm vitest run packages/workbench/src/glue/pty-client.test.ts
  packages/workbench/src/workers/pty-server.test.ts --reporter=verbose` →
  `8 failed | 97 passed`. Every new request/result, settlement, inspector, and
  owner-live/read-error case is RED; existing 97 cases stay green.
- `RIFTY_PLAYGROUND_PORT=5393 pnpm exec playwright test --config
  playwright.browser-unit.config.ts tests/browser-unit/owner-shell-routing.spec.ts
  --grep "direct workspace module"` → `1 failed`: expected exit 0, received 127
  with `/scripts/tool.mjs: command not found`.
- `RIFTY_PLAYGROUND_PORT=5392 pnpm exec playwright test
  tests/e2e/command-resolver-discovery.spec.ts --project=chromium-light
  --workers=1` → `1 failed`: `.rf-terminal-autocomplete` never appears after
  `vit` + Tab.

Attempt 2 re-cut, still before production changes:

- `pnpm vitest run packages/shell/tests/command-resolver-discovery.test.ts
  packages/shell/tests/bin-resolution.test.ts
  packages/shell/tests/language-service.test.ts --reporter=dot` →
  `15 failed | 31 passed`: the former green slash-miss assertion is RED;
  registered-only help, exact Bash failure classes, and live installed
  discovery are one projection suite.
- The PTY command above remains `8 failed | 97 passed`; its inverted-response
  case now first rejects a correct `opId` carrying a sibling `sid`, proves the
  target pending, then settles the correct result.
- `RIFTY_PLAYGROUND_PORT=5396 pnpm exec playwright test --config
  playwright.browser-unit.config.ts tests/browser-unit/owner-shell-routing.spec.ts
  tests/browser-unit/terminal-completion.spec.ts --grep "direct workspace
  module|explicitly addressed|TerminalPanel owner completion settlement"
  --workers=1` → `4 failed`: ordinary direct and explicit `.bin` both return
  127; a late reply publishes one stale menu; a rejected completion publishes
  no `Completion failed` element.
