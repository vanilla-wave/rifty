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
