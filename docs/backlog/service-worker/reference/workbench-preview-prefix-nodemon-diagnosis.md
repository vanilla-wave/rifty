# PR316 production nodemon stop — diagnosis, unresolved

2026-09-09. Read-only tracked tree. No fix, assertion changes, new runtime
controller, rebuild, or committed artifact. Parent owns generated `public/sw.js`.

## Finding

Two separate questions must remain separate:

1. `HTTP ok === false` is not a foreground-process/output settlement barrier.
   The exact starting-count assertion can fail against native nodemon with a
   delayed external stdout reader. A test barrier correction has independent
   native authority; it does not repair the cancellation error below.
2. Original production RED also logged
   `process.reserve: ppid 2 is outside caller 2's subtree` after Ctrl+C. Source
   identifies the rejected operation: supervisor tries to fork while its root
   process record has `terminationRequested`. New child admission is fenced;
   `[nodemon] starting` precedes the actual fork and does not prove new child
   Worker creation or execution. The uncaught cancellation path remains
   unresolved. None of the diagnostic replays captured this RED with a full
   timeline, so do not call the original failure fixed or waived.

## Captured original RED

Committed I5: `be8254b28683778925bdfd26a13b52df7446e4c0`.

Parent ran `RIFTY_PLAYGROUND_PORT=5483 pnpm test:e2e:prod`: 6/7 pass, Fullstack
journey fails. Isolated same journey on 5484 fails again. Parent logs:

- `/tmp/rifty-316-i5-app-prod.log`
- `/tmp/rifty-316-i5-app-prod-isolated.log`

`tests/e2e/fullstack-demo.spec.ts:222-240`: queue owner-VFS append from Shell,
switch Run tab, Ctrl+C, poll HTTP false, capture `starting` split length 7,
wait 2 seconds, HTTP still false, split length becomes 8. Tail:

```text
^C
[nodemon] restarting due to changes...
[nodemon] starting `node src/main.js`
Uncaught Error: process.reserve: ppid 2 is outside caller 2's subtree
```

Earlier `Failed to parse ESM source` is intentional syntax-fault acceptance,
not a discovery. Original RED aborts before its process-table/post-stop checks.

## Source trace: value birth and lifecycle

- `Terminal.handleCtrlC`, `packages/terminal/src/terminal.ts:1622`: echo `^C`
  before calling host signal. Echo is not owner receipt or settlement.
- `packages/workbench/src/glue/pty-client.ts:718`: `pty:signal` SIGINT frame.
- `packages/workbench/src/workers/pty-server.ts:357`: abort run controller.
- `packages/workbench/src/glue/run-foreground-child.ts:395`: handle kill sends
  **SIGTERM**; abort preserves output until real child exit. Do not suppress it.
- `packages/kernel/src/process-manager.ts:1745`: `killRecordTree` fences
  supervisor admission, signals actual descendants, waits exact descendant
  settlement before supervisor output cut and physical termination.
- `process-manager.ts:1002`: only SIGUSR2 is delivered as guest signal event.
  SIGTERM takes physical tree teardown. Native nodemon SIGINT/SIGTERM quit
  handlers therefore do not run on this Workbench abort path.
- `process-manager.ts:1976`: `ownsProcess(ownerPid, candidatePid)` checks
  `terminationRequested`/forwarded `killRequested` before its equal-PID success.
  For caller=ppid=2, the observed refusal requires that termination fence.
- `reserveRemoteProcess` / `VALIDATE_RESERVE_PARENT` reject before allocation;
  `spawnWorker` reserves before `spawnKernelWorker`. This refused fork cannot
  have created a new Worker. Existing child teardown may still be pending.
- Pinned nodemon `lib/monitor/run.js:35` logs `starting`, then `:137` calls
  fork. `:220-241` interprets killed-after-change child exit as restart and
  calls `restart()`. `:490-530` native quit path instead disables polling and
  replaces the child exit callback. A still-executing supervisor callback can
  thus emit `starting` during rifty's descendant settlement window, then hit
  the existing root admission fence.

ADR-0333 expressly requires child close callbacks + checkpoint before ancestor
output cut. Removing the barrier, allowing new reservations, dropping stdout,
or early UI-output closure violates current authority.

`spawn-worker.ts:304` already calls Worker error `preventDefault` before its
termination/duplicate guards (ADR-0347). Original Playwright `pageerror` alone
has not been traced to uncanceled creator propagation versus the origin
worker exception report. Need its actual Worker error / creator-global error
path before selecting a repair. An oracle fix alone cannot clear it.

## Native executed evidence

Pinned npm acquisition, own `/tmp` fixtures, Node **v24.16.0**, nodemon
**3.1.14**. Commands:

```sh
npm install --prefix /tmp/rifty-316-nodemon-diag/oracle nodemon@3.1.14 --save-exact --ignore-scripts
node /tmp/rifty-316-nodemon-diag/native-stop.cjs
node /tmp/rifty-316-nodemon-diag/native-delayed-stdio.cjs
```

`native-stop.{cjs,json}`: real HTTP app, entry append, signal after
0/80/120/200ms, both SIGINT and SIGTERM, HTTP probe, actual ChildProcess close,
2-second stable-output check, guest PID side-effect file. Eight cases:
HTTP gone and output stable after close; starting-count stayed stable after
first HTTP false in these unforced cases. Do not claim natural exact-count RED.

Direct demonstration of non-quiescence (120ms/SIGINT): first HTTP false
+0.30ms after signal, `APP_READY` received +2.27ms, nodemon close +20.73ms.
120ms/SIGTERM similarly delivered queued-marker text after first HTTP false.

`native-delayed-stdio.{cjs,json}` is explicitly a **fault probe**: only the
external Node stdout reader uses ordinary `.pause()` before append and
`.resume()` after first HTTP false. No nodemon changes, no fake sibling.
120ms/SIGTERM matches Workbench's actual signal and reproduces exact count RED:

| from signal send | observed |
|---:|---|
| +2.40ms | first HTTP false |
| +2.41ms | starting count = 1; external reader resumes |
| +2.51ms | buffered `[nodemon] starting` delivered |
| +3.62ms | actual nodemon close, code 143 |
| +2004.81ms | starting count = 2; close-based transcript stable; HTTP false |

This proves a slow stdout consumer makes the existing HTTP-based criterion
reject legitimate Node output. It does not prove that original browser RED
was only a slow consumer. Full trace of original RED is still missing.

## Browser executed evidence

Existing production dist served with **preview only**, port5485:

```sh
RIFTY_PLAYGROUND_PORT=5485 pnpm --filter @riftydev/playground preview
pnpm exec playwright test --config /tmp/rifty-316-nodemon-diag/playwright.config.ts
```

No build/dist/source writes. `/tmp` copy imports the real journey helpers.
Three original-action diagnostic replays pass: broad external Worker/MessagePort
logging, lighter logging with Worker init, minimal page-only in-memory PTY
logging without bundle interception. A fourth diagnostic variant waiting for
restart admission before Ctrl+C also passes; the observed fork completed 25ms
before Ctrl+C, so it missed the desired window. These are diagnostic passes,
not evidence that two original REDs disappeared.

Artifacts:

- `browser-trace-initial-pass.json`, `browser-initial-pass.log`
- `browser-trace-light-pass.json`, `browser-light-pass.log`
- `browser-trace-admitted-pass.json`, `browser-admitted-pass.log`
- `browser-trace.json`, `browser.log`, `terminal.txt`: last minimal page trace
- `diag.spec.ts`, `diag-original-copy.txt`, `trace-prelude.js`, `setup.py`

Last exact-action trace relative to Ctrl+C: page SIGINT send +1.22ms;
final nodemon `app crashed` chunk +7.76ms; foreground `pty:exit` +8.92ms,
code130/exact signal SIGTERM; HTTP502 +9ms; first-false observation +10ms.
Thus this pass's count baseline already happened after real foreground exit.
Full Worker trace showed child25 termination, supervisor callback output,
then supervisor2 physical termination, all before first HTTP false.
Cross-realm clocks can differ by sub-ms; do not infer sub-ms order across realms.

## Baseline / I5 attribution

`baseline-comparison.json` and `baseline/` retain isolated `git show a7163a692`
copies and SHA256. ProcessManager, spawn-worker, runtime NodeProcess,
run-foreground-child, pty-server and fullstack-demo spec are byte-identical
between baseline and current working tree. Current production node-entry
source-map contents for ProcessManager and NodeProcess also equal those files.

I5 did not introduce that fence/descendant-settlement mechanism or this test
criterion. I5 can still affect timing through preview networking; no actual
baseline production replay was run, so do not assert baseline RED reproduced.

## Fault class and remaining next step

- Test observation: `frozen-assumption` / `provenance-lie`; network HTTP
  unavailability projected into process/output settlement without authority.
- Process cancellation seam: `observable-order`, root owner ↔ supervisor ↔
  descendant Worker during admitted close. Real allowed fault: slow peer or
  callback while ancestor admission fenced. MessagePort duplicate/loss/reorder
  physically excluded while alive; no evidence for corrupt input/cache/storage.
- This is recursive Worker teardown, **not** same-realm
  `docs/backlog/kernel/queued-process-kill-cancellation.md`.
- Applicable sibling operations: ordinary installed `.bin`, foreground Node
  entry and nested fork use this authority; SIGUSR2 and same-realm handling
  differ. No new coordination mechanism justified by present evidence.

Smallest candidate oracle correction: await existing foreground settlement
before freezing output. Exact existing UI carrier:
`BottomPanel.tsx:112-120` `.rf-terminal-tab[data-running=false]` is sourced from
terminal UI status; `playground-terminal-ui.ts:180-202` sets idle only after
`run.exited` **and** `run.close()`. PTY owner has `awaitAbortSettlement:true`
and emits `pty:exit` after real handler/child settlement. Scope the original
Run tab; retain all count/API/route/process assertions. Prefer this state over
prompt text: Run was launched externally. UI status timing itself was source
traced, not independently instrumented in these runs. Independent oracle
review needed before altering tracked acceptance.

Remaining root-cause probe: capture the original RED with buffered
Worker-error/defaultPrevented and exact owner receipt/child settlement/PTY exit
trace. If it confirms cancellation error emitted from admitted terminal
callbacks, repair/classify that existing process-control seam with its own
RED, preserving fencing, descendant settlement and every admitted output byte.
No concrete runtime repair is justified yet; no finding was hidden in backlog.

## Follow-up: deterministic cancellation / ErrorEvent boundary

Three direct plus three nested-creator real Chromium Worker probes completed
(1.5s + 1.3s), using existing browser-unit harness on5487, actual ProcessManager,
actual SAB federation and actual Workers. `/tmp` cases:
`kernel-cancel.spec.ts`, `kernel-nested.spec.ts`, their configs/logs, and
`kernel-{global-error,exit,close}.json`, `kernel-nested-{global-error,exit,close}.json`.

The parent creates supervisor Worker; supervisor creates federated child Worker;
root kills supervisor; real descendant exit/close callback writes `starting`
and attempts federated spawn. No scheduling delays, fake process/VFS, or patched
runtime. External Worker decorator records the actual kernel error listener.

Both callback cases deterministically produce original-shaped reserve refusal.
Direct exit timeline: kill+0; callback+0.76ms; starting output+0.84ms;
origin global error+1.91ms; owner Worker error listener+1.99ms;
`defaultPrevented` becomes **true** inside shipped spawn-worker handler;
diagnostic stderr+2.13ms; physical terminate+2.24ms; one SIGTERM exit+2.36ms;
one SIGTERM close+2.54ms. No late process, final table PID1 only.

All six cases: creator global errors empty; Playwright pageErrors empty.
Thus this kernel cancellation path is contained and preserves the diagnostic
and admitted terminal outcome. The original App pageerror is NOT explained by
simply saying the root reserve fence throws: the same throw is correctly
contained both directly and with a real extra creator Worker.

A short actual sealed Workbench Node-server fixture also reaches the exact
reserve exception: real guest `child_process.fork`, child exit callback forks
again during stop. Trace shows origin error → creator Worker kernel listener
cancels → physical termination; pageErrors empty; subsequent owner `echo` and
process listing succeed. This fixture uses Node-server direct entry driver,
not nodemon installed-bin driver; its run-terminal subscription did not expose
the final diagnostic, so an exploratory `out contains process.reserve`
assertion was RED despite trace proving the attempted fork. Do not misreport
this exploratory assertion as a product regression. Artifacts:
`workbench-node-cancel-copy.txt`, `workbench-node-cancel.json`.

## Final bounded follow-up result

Actual installed-bin driver fixture initially passed in885ms. The subsequent
strengthened diagnostic rerun was RED on its expected-stderr assertion (below): normal linker-shaped import launcher, real CommonJS
`child_process.fork`, owner VFS, foreground `.bin` executor. The child exit
callback forks while ancestor termination is admitted. Exact transcript:
`CHILD_READY → starting DIAG_LATE → Uncaught process.reserve`.
The first run displayed diagnostic plus starting output. The second retained
starting but no diagnostic: actual ErrorEvent arrived after physical termination,
so the existing terminated guard emitted no new stderr. Its recorded data show
three Workers only (owner/supervisor/child), one prevented creator-boundary error,
SIGTERM stop=exit, empty pageErrors and successful subsequent owner echo/ps.
The diagnostic's expected-stderr assertion was too strong for this second
schedule; it is not a newly demonstrated product failure and was not weakened
then rerun. Original App tests remain parent-owned. Artifacts: `workbench-cancel.spec.ts`,
`workbench-cancel.json`, `workbench-cancel.log`, `error-prelude.js`.

One preceding fixture setup failed because I initially supplied a non-linker
`require(...)` launcher; shipped bin loader loudly rejected it. Corrected to
the actual `import(...)` shim syntax. This is an invalid diagnostic fixture,
not a newly found product defect (`workbench-invalid-launcher.log`).

**Queued error after physical termination is also directly proven contained.**
Real Worker timer task posts `diag.kill-now`, then throws. Creator receives
that native message and calls real handle.kill; zero stdout permits synchronous
physical termination. Browser later delivers its real ErrorEvent. No synthetic
event, delayed handler callback, runtime edit or manually invoked listener.

Direct observed ordering, relative to root kill:

| relative | actual event |
|---:|---|
| +0.635ms | Worker.terminate |
| +0.650ms/+0.655ms | remove message/messageerror listeners; error retained |
| +0.990ms | SIGTERM close |
| +1.050ms | browser queued Worker ErrorEvent; defaultPrevented=false |
| +1.070ms | same event after shipped handler; defaultPrevented=true |

No creator global error, Playwright pageerror, second diagnostic or second
terminal outcome; table PID1 only. Direct case274ms GREEN; nested creator
case329ms GREEN, explicitly asserting error delivery **after** terminate.
Files: `kernel-delayed-error.spec.ts`, `kernel-nested-delayed-error.spec.ts`,
their configs/logs; `kernel-queued-error-after-kill.json`,
`kernel-nested-queued-error-after-kill.json`.

Current actual production owner and node-entry sourcemaps both embed
`spawn-worker.ts`/`worker-like.ts` byte-identical to source. Owner and node-entry
spawn-worker both retain the error listener and preventDefault-before-guard.
The specific proposed listener-removal-after-terminate cause is unsupported
and contradicted by the executed real-event controls.

**Disposition:** no runtime change justified. Core cancellation error is an
expected loud admission refusal, handled at its owning Worker boundary under
ADR-0333/0347; suppressing it or skipping descendant callbacks is unwarranted.
The original captured **Playwright pageerror** remains an untraced observation;
it is neither equivalent to that stderr diagnostic nor cleared by these
controls. No claim of root cause for that distinct propagation observation,
no claim fixed. Bound reached: retain original exact repro/log plus these
controls in a finding draft per rifty-fix step1; caller runs its remaining
gate once, independent Final assesses obligation/routing. Parent reports its
new canonical production Fullstack run passed38.5s with no pageerror; that is
parent-run evidence, not a replacement for the original observation.

The strengthened `.bin` run itself independently hit the requested delayed
**exact process.reserve** event window: origin error at1788953821092.6099;
physical supervisor terminate at1788953821092.7402; its real creator ErrorEvent
at1788953821093.6200; existing handler changed defaultPrevented to true
at1788953821093.6650. Playwright pageErrors remained empty and the Workbench
owner executed the following command. Thus post-terminate containment is proven
for both the minimal Worker throw and the real Workbench cancellation exception.
This observation came from a RED exploratory stderr assertion, not a GREEN
claim. No further replay; harness5487 stopped.
