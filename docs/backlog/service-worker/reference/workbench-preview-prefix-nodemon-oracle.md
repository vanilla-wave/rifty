# PR316 nodemon stop oracle — independent critic

2026-09-09. Reviewer `/root/nodemon_stop_oracle_critic`, depth1/max1, no children.
Reviewed HEAD `be8254b28683778925bdfd26a13b52df7446e4c0`. Tracked files untouched.
Only pre-existing tracked diff remains `apps/playground/public/sw.js`.
No rebuild. Existing production dist served by preview5485.

## Verdict

**ACCEPT revised correction: exact original Run tab idle, then a real echo
marker in that same terminal, then freeze the starting-count baseline.**
Keep every existing HTTP/count/route/process/launch-fault assertion unchanged.
This corrects measurement provenance; it does not weaken the accepted teardown
contract or require a user scope amendment.

**Idle-only is semantically justified but is not a complete DOM-output barrier.**
It settles foreground execution/delivery, while `terminalBuffer()` reads an
asynchronously refreshed DOM mirror. Independently observed a mirror refresh
16.215ms after idle. The extra real terminal command closes that specific gap.

**This ruling does not resolve or waive** the original
`process.reserve: ppid 2 is outside caller 2's subtree` pageerror. Original
production RED remains separate and unresolved. Green scratch journeys are
not Final+GREEN for I5/PR316, nor proof the original failure was only buffering.

## Authority

- `AGENTS.md` Fidelity: real Node behavior, preserve admitted output, no test
  edit merely to pass. Here a pinned native execution disproves the HTTP-based
  frozen assumption; the change follows that oracle.
- ADR-0327: real nodemon owns restarts/output; exact Ctrl-C teardown; built
  Chromium observes no residual process/route after closure. No clause makes
  first HTTP unavailability a process/output completion event.
- ADR-0333: descendant close callbacks/checkpoint precede ancestor output cut;
  slow live peers may delay settlement. Legitimate admitted final text must
  remain visible during termination.
- Existing accepted native carrier already uses `ChildProcess.close` before
  teardown observations:
  `docs/backlog/playground/reference/nodemon-3.1.14-loop-probe.md:178-182`.
- `REV-2/3`: no unsupported stronger HTTP-implies-close requirement.
  `RDY-6`: carriers are agent-owned. No accepted invariant or scenario is
  removed. `REV-12`: independent cancellation discovery remains with its work.

## Independently read source

1. `BottomPanel.tsx:112-120`: exact terminal `data-running` reflects that
   session status, not HTTP state. Broad `[data-running=false]` is invalid:
   Shell/Problems can already be idle.
2. `playground-terminal-ui.ts:180-202,239`: original project Run idle is set
   only after `run.exited` settles and `run.close()` settles. Finally also
   covers failure; idle is completion, not a success/error-free certificate.
3. `project-session.ts:141-153`, `project-terminal.ts:425-450,546-562`:
   ProjectRun delegates real terminal exit and close, with runtime cleanup.
4. `pty-server.ts:434,438,455`: `awaitAbortSettlement:true`, await Shell result,
   then emit `pty:exit`. `pty-client.ts:844-873`: chunk delivered to its sink;
   exact exit resolves run. Ordered PTY transport plus kernel output cut
   supplies prior-output delivery, not absence of earlier admitted text.
5. `run-foreground-child.ts:356-375`: Ctrl-C owner abort requests SIGTERM;
   output stays open until real child exit. Native SIGTERM is the matching
   probe signal; no claim that rifty runs nodemon's native quit handler.
6. `helpers/playground.ts:42-45`: `terminalBuffer()` reads DOM attribute.
   `TerminalPanel.tsx:165-188,384-388`: writes schedule mirror refresh.
   `terminal-buffer-scheduler.ts:39-40`: 16ms debounce/150ms cap.
   `terminal.ts:784-798`: snapshot itself awaits xterm's parse FIFO.
   Therefore idle alone cannot certify the mirror reflects all delivered text.

## Executed evidence

Artifact directory: `/tmp/rifty-316-nodemon-stop-oracle-critic/`.

### Native

Node v24.16.0, real nodemon3.1.14 from supplied pinned npm installation.

`node /tmp/rifty-316-nodemon-stop-oracle-critic/native-replay.cjs`
(source copied unchanged from supplied `native-delayed-stdio.cjs`):

- Explicit external-reader fault: pause stdout, append entry, SIGTERM at120ms,
  first HTTPfalse, resume reader. Package/runtime untouched.
- `native-replay.json`: at first HTTPfalse, starting count1; buffered starting
  arrives +0.111ms; actual close +2.329ms; after2s count2. HTTP remains false,
  close-based count stable. One app PID side effect despite two starting logs:
  a `starting` line alone does not prove successful app creation/execution.
- This independently reproduces the false exact-count criterion against real
  Node under a delayed reader. It does **not** prove a natural exact-count RED.
- Independent `native.cjs` variant waited for a real second app before sending
  SIGTERM. Its HTTPfalse observation happened after exit/close, so count was
  stable; its deliberately expected-RED check exited1. Retained verbatim as
  `independent-initial.json`/`native.json`, not counted as a runtime failure or
  supporting reproduction. Reader pause alone does not guarantee the race.
- Supplied unforced `native-stop.json`: eight cases, no exact-count RED.
  Its late non-starting output demonstrates non-quiescence only.

### Production browser

Commands (one worker/retries0; ordinary real fixture/helpers):

```sh
RIFTY_PLAYGROUND_PORT=5485 pnpm --filter @riftydev/playground preview
pnpm exec playwright test --config /tmp/rifty-316-nodemon-stop-oracle-critic/playwright.config.ts
pnpm exec playwright test --config /tmp/rifty-316-nodemon-stop-oracle-critic/mirror.config.ts
pnpm exec playwright test --config /tmp/rifty-316-nodemon-stop-oracle-critic/marker.config.ts
```

- `corrected.spec.ts`, `browser.log`: idle-only addition; all original
  assertions preserved; **1 passed (38.4s)**.
- `mirror-trace.spec.ts`, `mirror-browser.log`: same journey plus passive DOM
  MutationObserver; **1 passed (37.3s)**. `mirror-trace.json`: Run idle
 21022.935ms; mirror update21039.150ms. Count stayed7 in this trace; no claim
  of a count-changing post-idle RED.
- `marker.spec.ts`, `marker-browser.log`: exact idle + ordinary same-terminal
  echo + standalone marker match, every original assertion retained;
  **1 passed (34.7s)**. `marker-oracle-only.diff` records only carrier additions.
- These runs did not reproduce the separate reserve pageerror. That is limited
  replay evidence, not cancellation closure. Original logs remain authoritative.

## Revised carrier and discrimination

After original HTTPfalse assertion, await `.rf-terminal-tab` containing the
exact `Express + SQLite scratch` role-tab to have `data-running=false`.
Then `runTerminalLineSettled(page, echo UNIQUE_MARKER)` in that same active Run
terminal and explicitly await a standalone output line (`^MARKER\\r?$`, multiline)
in `terminalBuffer(page,0)`. Then retain the original count capture and all
following assertions.

The explicit standalone line matters: a substring can match the typed command;
`runTerminalLineSettled` itself has an activity/250ms fallback, not an exact
marker proof. No VFS edit or synthetic nodemon output is introduced. Running
ordinary commands in this terminal is already part of the original post-stop
`ps`/launcher checks.

Named discrimination:

- Correct termination with HTTP gone while admitted final output is pending:
  HTTP-only count can fail (executed native RED); idle orders actual execution,
  marker orders the subsequent DOM snapshot behind every prior terminal write.
- Premature/stale mirror after real exit: idle alone permits it (executed DOM
  ordering); a later genuine marker cannot appear before prior FIFO writes.
- Continued live server fails unchanged HTTP checks; an honestly running
  supervisor fails exact idle; residual known supervisor/descendants fail the
  unchanged process-table check; continued restart output fails unchanged
  two-second count stability. No original assertion is dropped or loosened.
- Existing two-second observation is finite, not a proof of arbitrary future
  silence. Marker/counted text cannot establish cancellation-path correctness
  or absence of reserve pageerrors; that remains the independent defect.
