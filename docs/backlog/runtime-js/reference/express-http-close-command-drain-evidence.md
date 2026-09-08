# HTTP close command drain

## Authority and baseline

User request: implement `express-http-close-command-drain.md`, deliver green PR.
Captured finding: `c31cd02ae:docs/backlog/runtime-js/express-http-close-command-drain.md`
(PR #314 baseline `df3cd222f`). Reproduced here on `b26e2c42e`.
Scope: ordinary Workbench `node` command, real npm Express 4.21.2 self-request,
response consumed, last server closed, natural exit matching Node.
Other ports/timers/re-listen and eval terminal precedence retain Node baseline.
No claim of complete libuv/socket accounting; ADR-0152/0158 subset remains.

## RED — 2026-09-08

`RIFTY_PLAYGROUND_PORT=5417 pnpm exec playwright test --config playwright.browser-unit.config.ts http-close-command-drain.spec.ts`

- Same committed program, real npm Express 4.21.2, Node v24.16.0:
  `{"exit":0,"out":"200 EXPRESS_REGISTRY_OK\nCLOSED\n"}`.
- Chromium: `command did not drain: 200 EXPRESS_REGISTRY_OK\nCLOSED`;
  15-second command watchdog, 1 failed (23.9s including boot/install).
- Initial unbounded fixture helper also timed out at 120s; bounded helper
  preserves output and cleans the terminal after observing failure.

`pnpm exec vitest run packages/runtime-js/src/internal/event-loop-keepalive.test.ts`

- 1 failed / 25 passed: `holds eval flush until caller-owned handles and timer refs both drain`.
  Expected `[]`, received `['print']` while the caller's live handle remained.

## Root cause and class sweep

`node-program-lifecycle.ts` returns permanently after the first nonempty port
set. `watchServedPorts` observes unregister and removes preview, but owns no
command settlement. No leaked handle is necessary: the lifecycle has abandoned
the only drain-to-exit path. `awaitDrain` also cannot see registry listeners.

Boundary: in-realm port registry → foreground drain; synchronous ordered
register/unregister events, current registry is authoritative. Fault axes:

| Fault matrix | Required outcome |
|---|---|
| `unbounded-read`: completed response + last close | natural exit → scenario |
| `observable-order`: close then timer/re-listen; other port remains | no early exit or eval print → ADR-0152 |
| `observable-order`: terminal error/explicit exit with a live port | terminal still wins → ADR-0342 |
| `sibling-drift`: file vs eval command | same natural drain → scenario |

Excluded at this boundary: transport loss/replay/duplicate/reorder (no transport),
storage quota/torn writes/cache poisoning (no storage). Slow async entry/claim
and repeated port changes are reachable; the existing timer/registry model applies.
Sibling sweep: `node-entry-bootstrap` and parity-runner `worker-env-kernel-worker`
call the same lifecycle; both pass the current registry to drain;
`dev-server-child-bootstrap` uses `watchServedPorts` for the separate template
stop-handle lifetime (ADR-0155 §1); kernel run-to-completion already drains.
Keepalive lease owner remains runtime-js; preview map remains `watchServedPorts`.

## Decision

Independent read-only decision reviewer `/root/lifecycle_decision` examined
raw finding/code/ADR-0155/0342. Selected one drain + live-registry predicate;
rejected mirrored refcount and cancel/restart routes. ADR-0385 records scope
and partial supersession. Preparation uses observed baseline + executed RED
(`RDY-8`), no new promise or speculative oracle.

## Changed checking criteria

ADR-0385 removes the permanent serve return and release-on-port handoff. Legacy
lifecycle tests now observe live preview without awaiting process completion;
the obsolete release-call-order test is removed. Runtime lease/terminal tests
remain. The actual Node/Express differential moves from browser-unit to
`tests/e2e/http-close-command-drain.spec.ts`, in mandatory chromium-light CI.

Typecheck found the parity-runner caller during integration; its wiring now
uses the same predicate, preserving its physical worker oracle.

## Audit carrier correction

First full gate: typecheck found removed dependency in the physical parity
worker. Unit battery: 9761 passed, 2 failed, 18 skipped; 0 vitest timeouts.
Preview idle-stream assertion (502 vs 200) plus late closed-channel rejection
passed its isolated file rerun; load was 23.0/30.9/18.2 on 12 CPUs. No speculative
preview change. Concurrent-eval VFS audit still failed in isolation: expected 2
physical reports, received 0.

Root cause: audit used `finally` after node-entry import; a live served lifecycle
now correctly keeps that import pending until exit. Parent SIGTERM prevents the
finally report. The existing physical IPC interceptor now reports before
`control:listening` or self-exit; same one-shot child-local observation, same
validation, no synthesized report or reduced mutation set. Decoder/eval carrier
writes precede listener publication; the parent may stop only after preview.

New RED: `pnpm exec vitest run tools/node-parity-runner/src/run-in-rifty.test.ts -t 'served eval still audits'`:
expected exact transient write/rm VFS mismatch; received missing physical report.
Existing concurrent preview and new served-carrier fault tests preserve both
success and fault criteria. First full parity lane passed (60.2s).

## GREEN and discrimination

- Real Node/Express vs Chromium: 7/7 scenarios in mandatory e2e (1.2m): final
  close, eval, tail timer/exitCode 7, close-callback re-listen, second live port,
  delayed first listen, explicit eval exit 9 while listening. Output and exit
  equal the same-source Node v24.16.0 program in every case.
- Runtime + lifecycle + physical parity-runner files: 87/87 (20.47s), including
  concurrent preview audits and the exact served transient-write/rm fault.
- Revert-check: removing `hasRef` gate returns early-print RED (1 failed);
  removing listening audit returns missing-report RED (1 failed). Both originals
  restored in `finally`; no mutant remains.

The legacy generic-server e2e claimed close-without-process-exit while its guest
owned no remaining handles. It now explicitly keeps a ref interval and requires
AFTER_CLOSE output before Ctrl-C, retaining its original port-vs-process proof.
The test already documents preview reply loss during bridge teardown; its
closed-channel pageerror is that existing boundary, not a new socket-drain claim.

- Existing node-command / cli-report / generic-server e2e: 15/15 (1.5m).
  Updated explicit-ref generic-server assertions: 2/2 (25.6s).
- Production build lane: 7/7 (2.5m): child Buffer, owner boot, Express+SQLite,
  Hono, Koa, TypeScript editor, Webpack cold install/HMR/reload.
- Express oracle cases run in order even under fullyParallel: the native
  reference shares a loopback port; failures/retries remain independent.
