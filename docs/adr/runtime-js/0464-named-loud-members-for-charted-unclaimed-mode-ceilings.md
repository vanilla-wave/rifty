# ADR 0464: Named-loud members for charted unclaimed-mode ceilings

Status: Accepted
Date: 2026-09-25

> TL;DR: A Node-own member that an unclaimed mode listed ❌ on a compat page reaches first, whose absence gives a bare `TypeError` instead of a named ceiling, ships with Node's shape: real where Node's value is data, a named `NotImplementedError` where the behavior is unsuppliable. Partially supersedes ADR-0443 §2's "stay absent" clause (dated note there); admitted: `vm.constants` (+ the `DONT_CONTEXTIFY` context ceiling) and `http.Agent`.

## Context

ADR-0443 §2 admits a named-loud builtin member only for a claimed consumer's
link/load edge; the rest stay absent. Goal `vitest-run-in-browser` I7 needs
each ❌ mode on `docs/public/compat/vitest.md` to fail with a named throw, never
a bare error. Two modes reach an absent Node member first (evidence
`docs/backlog/runtime-js/reference/vitest-run-acceptance-evidence.md`
§Static reads, §IMPLEMENT):

- `environment: 'jsdom'`: jsdom 30.0.1 `lib/jsdom/browser/Window.js:58`
  `vm.createContext(vm.constants.DONT_CONTEXTIFY)` → rifty `TypeError: Cannot
  read properties of undefined (reading 'DONT_CONTEXTIFY')`. Node's value
  (v24.16.0): frozen null-prototype `{ USE_MAIN_CONTEXT_DEFAULT_LOADER,
  DONT_CONTEXTIFY }` symbols; `createContext(DONT_CONTEXTIFY)` returns a fresh
  context's own global.
- browser mode: playwright-core 1.60.0 `lib/utilsBundle.js:2150`
  `class extends http.Agent` and `lib/coreBundle.js:7921-7946` subclasses of
  `http.Agent` / `https.Agent` constructed at load → rifty `TypeError: Class
  extends value undefined`. `https.Agent` already throws
  `NotImplementedError('node:https.Agent')` (ADR-0181 D3).

## Decision

1. Admission (beyond ADR-0443 §2's claimed consumers): a Node-own member is
   admitted when a mode a compat page lists ❌ reaches it before any named
   ceiling and its absence gives a bare `TypeError`. Per observed edge, cited by evidence; the ❌ row
   names the resulting throw.
2. Shape follows ADR-0443 §1: Node's descriptor on the same owner. Data the
   realm supplies faithfully ships real (parity); unsuppliable behavior
   throws `NotImplementedError('<feature>')` where it is exercised, after
   Node's argument validation.
3. `vm.constants`: Node's value (parity `vm/constants`). `createContext`,
   `runInNewContext` and `Script#runInNewContext` given `DONT_CONTEXTIFY`
   throw `NotImplementedError('vm.createContext.DONT_CONTEXTIFY')`: both
   engines (ADR-0142) contextify a given object; neither hands out a realm's
   own global. As `importModuleDynamically`, `USE_MAIN_CONTEXT_DEFAULT_LOADER`
   hits that option's existing throw.
4. `http.Agent`: a class with Node's name, `length` and descriptor,
   subclassable; construction throws `NotImplementedError('node:http.Agent')`
   — no socket pool, as ADR-0181 D3 rules for `https.Agent`. `http.globalAgent`
   is not admitted (no observed edge).

## Alternatives and evidence

| Candidate | Disposition |
|---|---|
| Named member per observed ❌-mode edge | Selected: the mode fails with its feature id; nothing fabricated; shape parity + ceiling unit tests |
| Keep the members absent | Rejected: jsdom and browser mode fail with bare `TypeError`s — goal I7 and acceptance row 9 require a named throw |
| Real `DONT_CONTEXTIFY` (a QuickJS realm's global through the membrane) | Rejected here: new membrane identity machinery for a mode the goal leaves unclaimed; epic `jsdom-environment-in-browser` owns feasibility |
| Benign `http.Agent` accepted and ignored by `http.request` | Rejected: pool options silently not applied — ADR-0181 D3 already refuses it for `https` |
| Mode ban (sniff vitest `environment` / provider) | Rejected: package-shaped patch, a goal-rejected route |

## Consequences

- vitest `--environment=jsdom` and browser mode fail with their named
  ceilings (acceptance evidence §GREEN); `vitest.md`, `http.md` and
  `modules.md` carry the ❌ rows.
- A later real implementation replaces the throw and its ❌ row.
