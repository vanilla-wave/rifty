# Vitest acceptance evidence — 2026-09-23

Exact Vitest4.1.11 / Vite8.0.16. Shared manifest, TypeScript config/source/tests
and excluded-file sentinel: `tests/e2e/fixtures/vitest-run/project.ts`.

## Native baseline

Executed Node v24.16.0:

```sh
node --import tsx tests/e2e/fixtures/vitest-run/native-oracle.mts
```

The script makes a fresh temporary project, runs real npm install and all five
commands against the same files as Chromium. It validates reporter counts,
assertion diff, config exclusion, filenames on failure/verbose and verbose
names. Timing/ANSI are not compared. Results:

| Command | Failing fixture | Fixed fixture |
|---|---|---|
| vitest run | exit1, 1failed/1passed | exit0, 2passed |
| vitest run --pool=forks | exit1, 1failed/1passed | exit0, 2passed |
| vitest run --pool=threads | exit1, 1failed/1passed | exit0, 2passed |
| vitest run --reporter=verbose | exit1, 1failed/1passed | exit0, 2passed |
| npm test | exit1, 1failed/1passed | exit0, 2passed |

Native default reporter may omit the file line for a fast passing file. The
browser assertion therefore requires it on failure and verbose runs; counts
and status remain required on every run. This corrects an overstrong criterion
from reference observation, not a concession to browser output.

## Browser status

Carrier: `tests/e2e/owner-shell-vitest.spec.ts`, chromium-heavy, dedicated fresh
playground port. Initial RED: bare-version override, then Symbol guard, then
unset exitCode and missing manual MessagePort refs. Individual repairs carry
native/browser artifacts. An earlier reported PASS reused an unverified server
and was withdrawn; it is not acceptance evidence. Full current-branch GREEN
and unclaimed-mode ceiling probes remain pending.

Fresh Chromium5424, source a728f986a: I4 subset GREEN,47.1s. For this diagnostic
only, the threads command was omitted from the unchanged e2e loop; `finally`
restored the original file byte-for-byte. All8 executions (default, explicit
forks, verbose, npm test × failing/fixed) satisfied the existing assertions.
This proves I4's reporter/config/TS/status path, not I5 or overall acceptance.
Full5419 had already reached `worker_threads.Worker.execArgv` on threads;
generic required startup flag support is the next unit.


## Full accepted run and installed ceilings

Fresh Chromium5438, unmodified `owner-shell-vitest.spec.ts`: all10 commands
PASS,47.1s test/53.8s total. Typed v6 startup options are active in both pools;
this is not the earlier forks-only diagnostic. Final integration rerun remains
part of the PR gate after fatal-error and native-carrier repairs.

Installed-mode5437 project adds jsdom30.0.1, happy-dom20.0.0,
@vitest/coverage-v84.1.11, @vitest/browser-playwright4.1.11 and playwright1.60.0.
Actual commands/config are committed in owner-shell-vitest-ceilings.spec.ts.
All four exit1: vm.constants.DONT_CONTEXTIFY; ESM Function-assignment ceiling;
missing node:inspector/promises builtin; node:https.Agent socket-pool ceiling.
Browser provider config includes enabled:true, playwright() and chromium
instance. Missing peer packages are not counted as runtime-ceiling proof.

Before the bounded fixes, jsdom hit undefined constants and Playwright hit
undefined http.Agent during class declaration. Named-capability RED→GREEN:
optional builtin unit4 + VM conformance40; HTTP Agent/client/HTTPS tests53.
Native Node24 confirms DONT_CONTEXTIFY is a symbol producing an unwrapped
context; rifty rejects access explicitly. HTTP Agent subclass declaration is
valid natively and on rifty; constructing its unavailable pool stays named-loud.

I7 amendment remains pending: Vite8.0.15 default fail/fix passes; watch performs
its initial run and waits45s until manual Ctrl-C. These observations do not
certify their wider lifecycle, nor justify an artificial ban. Proposed public
compat wording uses an exact guarantee and explicit measured limits; goal.md
has not been changed without the user's answer.


Final composed dev-server proof, fresh Chromium5440:

```sh
RIFTY_PLAYGROUND_PORT=5440 pnpm test:e2e:heavy tests/e2e/owner-shell-vitest.spec.ts tests/e2e/owner-shell-vitest-ceilings.spec.ts
```

2/2 PASS,2.1m. Main10runs47.0s; installed six-mode ceiling test1.2m.
vmThreads/vmForks now fail at their actual unsupported experimental VM startup
flag with worker_threads.Worker.execArgv / child_process.fork.execArgv. All
six installed/configured negatives exit1 with their asserted capability label.
The positive scenario and ceiling assertions are committed unchanged from this
run. Watch and other-version observations remain separate from these claims.

A broader same-realm HTTP preview regression exposed a MessagePort wrapper
losing native postMessage's return signal used internally by Node BroadcastChannel.
New real-native carrier test reproduced `Message could not be posted`, then
passed after preserving delegated returns. The two original preview assertions
and full55-case harness pass unchanged. No mocked transport or status synthesis.
