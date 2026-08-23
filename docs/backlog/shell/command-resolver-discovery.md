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
   and owner read failure cannot hang or publish a stale result. The real
   Playground→BottomPanel→TerminalPanel binding reports
   `Completion failed: <reason>` through the product error toast and leaves no
   completion menu.

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
4. PTY tests RED: exact `sid/opId` correlation, inverted/wrong-sid replies,
   timeout/disconnect/close settlement, and exhaustive frame-domain validation.
   One real `createPtyClient`↔`createPtyServer` loopback proves both live-owner
   success and injected owner `readdir` failure through the exact client
   rejection; separate locally synthesized ends do not close this seam.
5. `tests/browser-unit/owner-shell-routing.spec.ts` RED: a direct workspace
   script runs in the real owner supervised child as `bin:false`, while an
   explicitly addressed `.bin` launcher runs its target as `bin:true`.
6. `tests/e2e/command-resolver-discovery.spec.ts` Chromium RED: typing installed
   bare and direct-path prefixes opens the real DOM menu; selecting the direct
   entry runs it and records exit 0.
7. Same e2e spec on the booted App holds one physical `pty:complete`, edits the
   live xterm line, releases it, observes the matching result, and requires no
   late menu. With another real request pending it terminates the actual
   `workbench-owner` and requires the product error toast plus no menu. The
   boundary decorator restores MessagePort descriptors; no test-owned UI.

## Fault matrix

| Boundary × operation | Fault axis | Honest outcome / test target |
|---|---|---|
| page client↔owner server completion | quota-perm-fail / peer death / port close / finite-ACK timeout | real client↔server loopback carries owner `readdir` failure exactly; client timeout/disconnect/close settle once; e2e owner death shows the product error toast, no menu |
| completion `sid/opId` + edit state | concurrent-same-key / observable-order | inverted/wrong-sid replies settle only matching calls; e2e holds, edits, releases the matching result, and publishes no stale menu |
| PTY completion trust boundary | corrupt-input | reject missing/extra/wrong fields; empty IDs; negative/fractional/non-finite/inverted offsets; non-array items; missing/non-string values; bad optional display; nested extras; malformed success/error branches |
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

ready-verdict: 2026-08-24 — Contract+RED @ 465597e0d2b8f729e20fb0a2cb66e74316e308b5 — BLOCKED; implementation forbidden

- `checkpoint-lineage: [c3d83ef02d5e92db14d61aa7f010073f619add4f,
  465597e0d2b8f729e20fb0a2cb66e74316e308b5]`.
- Contract+RED @ `465597e0d2b8f729e20fb0a2cb66e74316e308b5`
  BLOCKED: replace separate client/server fault proofs with one seam round
  trip, move UI fault acceptance from browser-unit to real Playground e2e,
  exhaust offset/item frame domains, and do not fabricate a `ready-verdict`.
  Attempt 3 is the mandatory in-place re-refinement: it replaces those proof
  carriers without weakening Acceptance or changing production scope; the
  removable browser-unit harness is deleted and production remains untouched.
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

Re-refined attempt 3 deletes that wrong-lane/test-owned UI harness. Its RED
allocation is:

- `pnpm vitest run packages/workbench/src/glue/pty-client.test.ts
  packages/workbench/src/workers/pty-server.test.ts --reporter=dot` →
  `7 failed | 97 passed`: client timeout/close/correlation plus the strict
  inspector and real client↔server owner-failure seam are RED; all 97 siblings
  stay GREEN.
- `RIFTY_PLAYGROUND_PORT=5397 pnpm exec playwright test
  tests/e2e/command-resolver-discovery.spec.ts --project=chromium-light
  --grep "superseding|owner death" --workers=1` → `2 failed`: both held-request
  probes remain in `waiting` because production emits no `pty:complete` yet.
