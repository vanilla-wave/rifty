---
kind: epic
status: ready
title: "`node <file>` behaves and reports errors like real Node"
created: 2026-11-22
value: A program run as `node <file>` sees Node's entry identity, and its fatal error reads as Node's — right file and line in Node's frames, the source line where Node's header is provable — so an agent can fix it.
user_story: As a service running model-written JS in rifty (browser or V8 isolate), I want `node <file>` to behave and fail like Node, but today `require.main === module` is false and a fatal error prints shifted lines, rifty frames and no source header.
tier: works
---

## Outcome

A Node program started as `node <file>` in rifty observes what Node gives an
entry and its dependencies, and dies with Node's status and Node's stderr
bytes except where a named compat row says otherwise. The user scenario: an
agent writes JS, runs it, reads the error, fixes it — the diagnostic names the
right file and line (Node's frames), and the source line with its caret where
Node's header is provable; never a wrong one. One implementation
in `runtime-js` serves every host that runs a file: the no-COI SDK, the COI
Workbench kernel child and the isolate guest bundle (ADR-0557). What cannot be
made Node's is a named compat row with its cause, never a silent difference.

## User scenario

1. The host writes project files and runs `node <file> [args]`.
2. The program runs as Node's main module: `if (require.main === module)
   main()` runs `main`; `module`, `__filename`, `__dirname`, `process.argv`,
   `require.cache`, relative `require`, `import.meta` for an ES module entry
   read as in Node.
3. The program dies (throw in the entry or a dependency, from a timer or an
   async function, unhandled rejection, non-`Error` value, syntax error,
   missing module, error with `cause` or own props). The host reads stderr and
   the exit status: Node's report — the inspected error with user frames at
   Node's positions, `Node.js` trailer, and the `<file>:<line>` header with
   source line and caret where it is provable (an unhandled rejection's error
   frame, a compile error naming its token); a synchronous throw has none.
4. The agent fixes the line the first frame (or the header) names and reruns.

Oracle: live `node <file>` v24.16.0 over the same files in a temp dir; one path
normalization (temp dir ↔ project root). Two declared projections, applied to
Node's side only (`nodeFileExpected` in the carrier fixture):

- P1 — Node's own source (`node:*`, `[eval]-wrapper`) has no rifty
  counterpart: its frames are deleted; a report header naming it (`node:…:N`,
  source line, caret, blank) is deleted; the `... N lines matching cause stack
  trace ...` line those frames feed is deleted; an inspect props opener ` {`
  on a deleted frame moves to the previous kept line. Nothing else is
  rewritten — a report left without frames keeps its unbracketed first line.
- P2 — the trailer names the runtime's own `process.version` (rifty v24.0.0,
  `runtime-js/process-versions-node-honesty`).

## Invariants

<!-- Evidence, main 50c9d8bf1, carrier `node-file-parity` (no-COI SDK and COI
Workbench, 2026-11-22, chromium; every corpus row differs; isolate rows
`packages/isolate-host/tests/node-file.test.ts`, all 19 differ): `entry-main-guard`
stdout '' (Node `main ran 2`), `require.main` undefined, `require.cache` an
empty object (loader.ts `req.cache = Object.create(null)`); `throw-top-level`
stderr `Error: boom\n    at Object.eval (<root>/main.js:3:7)\n    at
compileCjsSource (http://…/runtime-js/src/module-loader/cjs.ts:…)` … (Node
`<root>/main.js:1\nthrow new Error('boom');\n^\n\nError: boom\n    at
Object.<anonymous> (<root>/main.js:1:7)\n\nNode.js v…`); `syntax-error-entry`
`ModuleLoadError: Failed to compile CJS module …`; COI `throw-from-timer`
`Uncaught Error: timer (<root>/main.js:4)`. Isolate `throw-top-level` via
`node -e "require('./main.js')"`: `Error: boom\n    at Object.eval
(<root>/main.js:3:7)\n    at compileCjsSource (rifty-isolate-guest.js:…)`;
`unhandled-rejection-error`: the eval projection rewrites the file frame to
`[eval]:1` (Node: `<root>/main.js:2` header and frame). -->

1. I1. Entry semantics: on the carrier's entry corpus the program's stdout and
   status equal Node's — `require.main`/`process.mainModule` is the entry
   module (`id` `.`, `parent` null), dependencies see the same `require.main`
   and their own `parent`/`children`/`loaded`, `require.cache` holds the live
   records, `__filename`/`__dirname`/`process.argv`, and an ES module entry's
   `import.meta` and `require.main` (undefined); directory, `.cjs` and
   extensionless entries; a typeless `.js` with ESM syntax (detection).
2. I2. Fatal diagnostics: on the carrier's fatal corpus stderr bytes and status
   equal Node's under the one normalization and the two declared projections.
   A row that cannot reach Node's bytes is a named compat row with its cause.
3. I3. A fatal report prints no rifty-runtime frame or path; the frames it
   prints are the ones Node prints for user code (and V8 builtins), at Node's
   line, column and name.
4. I4. One implementation: I1–I3 hold on the no-COI SDK and the COI Workbench
   (carrier lanes) and the isolate guest bundle prints the same report through
   the same runtime code (isolate rows: a file `require`d from `node -e`).

## Challenge

challenge: 2026-11-22 — clear

Premise (hand-off from the manager thread, user-ratified destination): value
follows — the live sandbox's acceptance (agent reads the error and fixes it)
needs Node's entry identity and report; no cheaper route: each surface is
rifty's own runtime code shared by all hosts, a host-side rewrite would fork
the formatter per host (`sibling-drift`).

## Decisions

- amend: 2026-11-22 — manager thread (delegated by the user, reported to the
  user): after external review round 1, header only by construction; the
  rollback rule set in advance was taken — no synchronous-throw header —
  because V8's throw site is not readable from JS in general and a false
  header is worse than none — changed: Outcome and scenario steps 3–4 (the
  header where provable; the first frame names file and line); I2 unchanged
  (the headerless synchronous report is a named compat row, process.md "Fatal
  error stderr bytes"); remainder: `backlog/runtime-js/sync-uncaught-header-throw-site-source`.

- Module loading is a hot path: every loader change carries a before/after
  measurement of a require-heavy load (3061-module CJS tree, 15 runs, median)
  in the ledger.
- tier works: Chromium lanes + isolated-vm; Firefox/WebKit positions follow
  their engines' stacks (non-goal, ADR-0469).
- Carrier compares bytes after exactly one path normalization; P1/P2 above
  are the only oracle projections, listed in compat process.md "Fatal error
  stderr bytes" when the first fatal slice lands.
- COI carrier: the Workbench template root is `"type": "module"`; the carrier
  adds a typeless `nf/package.json` (`{}`), which keeps Node's no-package.json
  semantics (CJS, ESM syntax detection) for the programs below it.
- rejected route: host-side stderr rewrite per host (no-COI, kernel, isolate)
  — violates I4 (one implementation).
- rejected route: forging Node's `node:internal` frames — violates Outcome
  (no fake implementation).
