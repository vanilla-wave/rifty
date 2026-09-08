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
Sibling sweep: `node-entry-bootstrap` has one lifecycle caller for file/eval;
`dev-server-child-bootstrap` uses `watchServedPorts` for the separate template
stop-handle lifetime (ADR-0155 §1); kernel run-to-completion already drains.
Keepalive lease owner remains runtime-js; preview map remains `watchServedPorts`.

## Decision

Independent read-only decision reviewer `/root/lifecycle_decision` examined
raw finding/code/ADR-0155/0342. Selected one drain + live-registry predicate;
rejected mirrored refcount and cancel/restart routes. ADR-0385 records scope
and partial supersession. Preparation uses observed baseline + executed RED
(`RDY-8`), no new promise or speculative oracle.
