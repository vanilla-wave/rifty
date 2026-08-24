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
   A correlated success range must remain inside the originating line and span
   its cursor before it can settle that request.
   One real `createPtyClient`↔`createPtyServer` loopback proves both live-owner
   success and injected owner `readdir` failure through the exact client
   rejection; separate locally synthesized ends do not close this seam.
5. `tests/browser-unit/owner-shell-routing.spec.ts` RED: a direct workspace
   script runs in the real owner supervised child as `bin:false`, while an
   explicitly addressed installed Vite launcher crosses trusted package-tree
   admission and runs its real target. `owner-child-bin-executor.test.ts` drives
   ordinary direct, explicit `.bin`, and bare nearest `.bin` commands through a
   real Shell resolver into the production owner spawn-spec builder and pins
   their launch metadata as `bin:false`, `bin:true`, `bin:true`.
6. `tests/e2e/command-resolver-discovery.spec.ts` Chromium RED: typing installed
   bare and direct-path prefixes opens the real DOM menu; selecting the direct
   entry runs it and records exit 0.
7. Same e2e spec on the booted App holds one physical `pty:complete`, edits the
   live xterm line, releases it, observes the matching result, and requires no
   late menu. With another real request pending it terminates the actual
   `workbench-owner` and requires the product error toast plus no menu. The
   boundary decorator counts exactly one physical request per Tab and restores
   MessagePort descriptors; no test-owned UI.

## Fault matrix

| Boundary × operation | Fault axis | Honest outcome / test target |
|---|---|---|
| page client↔owner server completion | quota-perm-fail / peer death / port close / finite-ACK timeout | real loopback carries bare and path-like `readdir` failures exactly; client timeout/disconnect/close settle once; e2e owner death shows exact `(code null, signal SIGTERM)`, no menu |
| completion `sid/opId` + edit state | concurrent-same-key / observable-order | inverted/wrong-sid replies settle only matching calls; e2e counts one request per Tab, then holds/edits/releases one matching result without stale menu |
| PTY completion trust boundary | corrupt-input | mutation-cover request, both result envelopes, nested start/end/items: missing/extra/wrong; empty IDs/values; negative/fractional/non-finite/unsafe/inverted offsets; malformed items/display; correlated result range must stay within its request line and span its cursor |
| execution/discovery/which/suggestion siblings | sibling-drift | `command-resolver-discovery.test.ts`: one result projects consistently; no caller-owned precedence copy |

## Out of scope

- Native host PATH/process execution: absent VFS `/bin/echo` is a direct-path
  miss, never a host fallback. Compat remains ❌.
- POSIX execute bits, native/WASI shebang dispatch, symlink permissions: the VFS
  has no mode authority. Direct regular files use the existing Node-entry
  loader; unsupported bytes fail loudly there. Compat remains ❌.
- `which -a/--all` retains `NotImplementedError('shell.which.-a')`; `which -s`
  retains `NotImplementedError('shell.which.-s')`. `which.test.ts` pins both;
  compat remains ❌.
- Command descriptors/flag metadata remain
  `docs/backlog/shell/command-manifest-registry.md`; no speculative registry is
  added here.

## Decisions

ready-verdict: 2026-08-24 — Contract+RED @ e6d3ce0b48adc62a5d8bc3a68eec10fba0a8e11f

- `checkpoint-lineage: [c3d83ef02d5e92db14d61aa7f010073f619add4f,
  465597e0d2b8f729e20fb0a2cb66e74316e308b5,
  d31f7615ece9cd26e3d6e613a98fc10b6daf417d,
  dd1dc618aefe81619a129801d0e85ed0b4756e0b,
  07ad7789e0f73005e5da24424b2d38257f4f6054,
  9198a3aa0f4b1ac57097f5d74b7be8a7ae433630,
  f0eafa003c3e51a67ef688bac84ec69955d09496,
  c89073e0345fe2f22525793e3af595cce31ddc1b,
  b09f56f9c44aa5ef71e684942101f57996ff9a7f]`.
- Contract+RED @ `b09f56f9c44aa5ef71e684942101f57996ff9a7f`
  BLOCKED: the frozen Bash capture omitted whole-script locale and the
  implementation/build identity of `/usr/bin/which`. Attempt 10 recaptures the
  complete oracle under `LC_ALL=C`/`LANG=C`, pins the macOS build and every
  invoked host binary by identity/hash, and preserves every observable row;
  Acceptance, RED projections, and production remain unchanged.
- Contract+RED @ `c89073e0345fe2f22525793e3af595cce31ddc1b`
  BLOCKED: the declared public `ProjectTerminal.complete` wrapper lacked
  success/error/close RED, while Out of scope claimed unproven named ceilings
  for aliases/functions/PATH/completion grammar. Attempt 9 adds the wrapper
  carrier and narrows that ceiling to the exact existing `which` tags/tests;
  Acceptance and production remain unchanged.
- Contract+RED @ `f0eafa003c3e51a67ef688bac84ec69955d09496`
  BLOCKED: installed Vite output plus separately constructed spawn specs did
  not prove the explicit-path→owner classification seam. Attempt 8 adds one
  real Shell→production spawn-spec adapter sibling sweep for ordinary direct,
  explicit `.bin`, and bare nearest `.bin` without changing Acceptance or
  production.
- Contract+RED @ `9198a3aa0f4b1ac57097f5d74b7be8a7ae433630`
  PASS invalidated by a proof-carrier fault discovered during GREEN: manually
  writing `node_modules` correctly revokes package-tree readiness, so the
  generated throw-shim could not reach child bootstrap without bypassing the
  package authority. Attempt 7 preserves Acceptance and replaces only that
  unsafe carrier with a real installed Vite shim plus the existing exact
  `bin:true` spawn-spec RED. The same carrier re-cut restores the established
  typo-distance threshold and adds request-relative completion-range REDs.
  Production remains uncommitted for the fresh checkpoint.
- Contract+RED @ `07ad7789e0f73005e5da24424b2d38257f4f6054`
  BLOCKED: count every physical request, mutate nested start/end, cross the
  path-like reader fault, require exact SIGTERM exit identity, and make the
  explicit `.bin` fixture fail under `bin:false`. Attempt 6 adds only those
  discriminating REDs; production remains untouched.
- Contract+RED @ `dd1dc618aefe81619a129801d0e85ed0b4756e0b`
  BLOCKED: the real product toast RED asserted only the constant
  `Completion failed:` prefix, allowing a lossy empty reason. Attempt 5 pins
  the owner-exit reason and SIGTERM provenance; all transport siblings and
  production remain unchanged.
- Contract+RED @ `d31f7615ece9cd26e3d6e613a98fc10b6daf417d`
  BLOCKED: mutation-cover every missing/empty/wrong request and both result
  envelope fields, and keep blocked SHAs only in lineage — never in the
  reserved passing `ready-verdict`. Attempt 4 adds only those RED mutations;
  production remains untouched.
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
- Attempt 4 keeps the same `7 failed | 97 passed` PTY allocation and expands
  the strict-frame RED into mutation coverage of every request/success/error
  envelope field plus safe numeric and nested-item domains. It removes the
  blocked SHA from reserved `ready-verdict`; lineage above remains complete.
- Attempt 6 keeps the same expected-RED commands while strengthening their
  discriminants: exact-one request counts on all three e2e paths, nested result
  mutation cover, bare + path-like loopback failures, exact SIGTERM toast, and
  a shim body that throws unless the owner selects `bin:true`.
- Attempt 7 replaces only that last manual-node_modules fixture. At the
  committed checkpoint, the browser-unit direct installed Vite path remains
  127/`command not found`; the spawn-spec unit remains RED on `bin:false`.
  Installed suggestion uses a distance-one typo within the existing threshold;
  three correlated completion replies outside their originating line/cursor
  resolve instead of rejecting and therefore remain RED.
- `pnpm exec vitest run --project unit
  packages/shell/tests/command-resolver-discovery.test.ts
  packages/shell/tests/language-service.test.ts
  packages/shell/tests/bin-resolution.test.ts` → `15 failed | 31 passed`.
- `pnpm exec vitest run --project unit
  packages/workbench/src/glue/pty-client.test.ts
  packages/workbench/src/workers/pty-server.test.ts` →
  `10 failed | 97 passed`; all three request-relative ranges reach the wrong
  resolve path.
- `RIFTY_PLAYGROUND_PORT=5508 pnpm exec playwright test --config
  playwright.browser-unit.config.ts tests/browser-unit/owner-shell-routing.spec.ts
  --grep "direct workspace module|explicitly addressed installed" --workers=1`
  → `2 failed`: both paths exit 127 with exact `command not found` diagnostics.
- Attempt 8 keeps those allocations and adds
  `pnpm exec vitest run --project unit
  packages/workbench/src/workers/owner-child-bin-executor.test.ts` →
  `1 failed | 4 passed`: all siblings execute before assertion; exit codes are
  `[127, 127, 0]`, and the real Shell records only the bare nearest `.bin`
  launch, so the required ordinary/explicit/bare `false/true/true` projection
  is RED.
- Attempt 9 adds `project-terminal.test.ts` success/error/closed routing through
  a structural future `complete` carrier. `pnpm exec vitest run --project unit
  packages/workbench/src/workbench/project-terminal.test.ts
  packages/shell/tests/which.test.ts` → `3 failed | 40 passed`: all three calls
  fail because the public wrapper is absent; all 7 `which` siblings, including
  exact `shell.which.-a`/`shell.which.-s` loud ceilings, stay green.
- Attempt 10 recaptures
  `docs/backlog/shell/reference/command-resolver-discovery-bash-3.2.57.md` on
  macOS `26.3.1` build `25D2128`, Bash `3.2.57(1)`, Node `v24.16.0`, whole-script
  locale `C`, and SHA-pinned Apple `which`/`sort`/`tr`/`echo`. Every normalized
  selection, diagnostic/status, `which`, and sorted `compgen` row is unchanged.
