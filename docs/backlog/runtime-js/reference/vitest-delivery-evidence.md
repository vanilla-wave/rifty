# Vitest browser delivery

Source proof revision: f98099bf7aa5304b344a3b3b1cc215fcd379c0b8.
Goal: Vitest4.1.11/Vite8.0.16, `vitest run`, both pools, TypeScript config/tests.
User2026-09-25 accepts exact guarantee without other-mode/version bans, and
explicit binary IPC refusal. No package-specific Vitest runtime patch.

## Accepted outcomes

| Obligation | Executed carrier |
|---|---|
| I1 exact npm override/install | owner-shell-vitest manifest/tree/binding assertions; bare-version override tests |
| I2 Worker lifetime | worker-thread-lifecycle browser/native suite; late message, ref/unref, listener/parentPort/stdio/exit controls |
| I3 process events/exit | owner-node-process-lifecycle real browser/native; uncaught/rejection continuation, exit listener/code, fatal handler controls |
| I4 default/forks TypeScript fail/fix | unchanged owner-shell-vitest spec: config include, excluded sentinel, counts/assertion diff, exit1→0, npm test/verbose |
| I5 threads parity | same fixture and same expected counts/exit codes as forks |
| I6 module execution | exact installed tree executes all10 commands; startup preloads/conditions/resolve and VM offsets have separate native parity |
| I7 exact guarantee/limitations | compat/vitest.md; six actually installed/configured negative modes; watch/other versions unclaimed without bans |
| Binary IPC | both senders ×35 binary serialized graphs; exact named ceiling, no dispatch, channel recovery/getter once |
| Native exception identity | both senders preserve renamed Error/reused native DOMException thrown by getter; intrinsic class difference separately asserted |

## Runs

- Native exact fixture oracle: `node --import tsx tests/e2e/fixtures/vitest-run/native-oracle.mts`, Node24.16.0; all10 expected fail/fix outcomes. Earlier raw proof: `/private/tmp/rifty-vitest-reproducible-native-oracle.json`.
- Fresh Chromium5504: `pnpm exec playwright test tests/e2e/owner-shell-vitest.spec.ts tests/e2e/owner-shell-vitest-ceilings.spec.ts --project=chromium-heavy --workers=1`,2/2PASS2.1m. No reused server. Log `/private/tmp/rifty-native-ipc-final-vitest.log`.
- Fresh Chromium5506: binary/proxy/exception specs3/3PASS6.8s; native shape separately distinguished from platform DataCloneError. Log `/private/tmp/rifty-ipc-clone-errors-browser5506.log`.
- Physical nonbinary IPC parity4/4PASS; real kernel-backed Worker, both senders. Log `/private/tmp/rifty-ipc-clone-errors-parity.log`.
- Production5505: full8/8PASS4.6m, owner/Buffer identity, Express/SQLite,Hono,Koa, TS F12/diagnostics, Webpack HMR/reload. Log `/private/tmp/rifty-native-ipc-prod.log`; current source production CI separately required.
- Final source `pnpm pr:check`:25/25PASS; unit211.3s, parity76.3s. Log `/private/tmp/rifty-native-ipc-final-pr-check.log`.
- Final source `pnpm test:packed-consumer`:PASS237.9s, only actual tarballs, fresh Chromium, preview/HMR. Log `/private/tmp/rifty-native-ipc-final-packed.log`.

## Honest boundaries

- Advanced IPC clones once, then refuses binary serialized graphs. No Buffer identity promise or opaque-brand mutation probe. Platform clone failures expose DataCloneError; Node v8 uses Error. Guest-thrown values retain identity.
- QuickJS Proxy-backed object/array mirrors cannot cross native cloning; VM retained-mirror mutation/missing exotic return gaps remain separately documented.
- Later replacement of Error.prepareStackTrace is outside the certified VM offset renderer; vm-offset-stack-hook-replacement owns that gap.
- Worker entry/preload/drain rejection errors are carried; unhandled timer/global-error forwarding remains worker-threads-kernel-error-event.
- Unsupported inspect.custom serialization remains util-surface-completions with its named Worker error ceiling.
- Other Vite versions/watch are unclaimed; measured successful probes do not expand the guarantee.

The delivery Final verdict and exact-head CI determine closure. These historical
runs alone do not assert that a later source revision is green.

## Historical adjacent observation

Optional-SQLite CJS parent exited0 with no output at c689192c5 in
`tests/integration/fixtures/workbench-vite-consumer/src/sqlite-omission-proof.ts`.
Run `node tests/integration/workbench-packed-consumer.mjs` at that revision.
Cause was unproven; not evidence of an additional required defect. Its old
`worker-threads-kernel-run-to-completion-exit.md` account is preserved at f98099bf7.
Current Worker natural-exit/parent-lifetime proofs do not retroactively diagnose
that fixture. Runtime-js owns re-investigation if that exact program recurs;
`kernel/server-shaped-worker-process-lifecycle` retains the broader adjacent
lifetime question.

## Closure2026-09-25

Independent Final+GREEN at f98099bf7:204/204 coveragePASS, all axesPASS,
no findings or residuals; `goal_complete=true`. Canonical full verdict:
`vitest-delivery-final-green.json`; `tools/review/blockers.mjs` exit0.
Exact-source CI36130870229 completedSUCCESS:19/19jobs, including browser-unit,
production, hosted, heavy/light, no-COI, unit/parity and lint. GitHub PR351.

Completed goal and15childitems removed after that PASS; contracts/user decisions
remain at reviewed_sha and earlier git history. All reference evidence and the
explicit outside-result drafts remain. Final packaging is docs-only; pass-binding
and documentation gates verify that the reviewed source remains unchanged.
User requested one green PR, not merge; no merge performed.

## Post-CLOSE CI repair

Final b0 browser CI reproduced an existing Workbench close race:337PASS/1FAIL,
then isolatedrealfile5PASS/1FAIL. That supersedes any current-green implication
of the earlier source verdict. ADR-0468 repairs owner shutdown overtaking
session tool hooks, with a private causal admission signal. Fresh5509 real
browser9/9PASS and122unitPASS; no timeout/error masking. Full repair history and
fault matrix: `workbench-close-admission-evidence.md`. Re-bound Final and current
CI required before delivery; original source approval remains historical.

## Repair closure2026-09-25

Exact repaired/merged source1179ddfd4: fullgate25/25PASS, packed consumerPASS,
fresh5511 exactVitest10runsPASS; CI36139754267 completedSUCCESS19/19jobs,
including browser-unit108086559627. Independent Final rebinds214/214coverage
with no required residuals; canonical `vitest-delivery-final-green.json`.
The private admission repair carries real RED/GREEN and literal-revert RED;
no timeout changes or cancellation masking. Final records are docs-only;
ready-PR pass-binding and CI verify the delivered head. No merge performed.
