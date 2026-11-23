---
area: runtime-js
status: ready
title: "The isolate fatal report names rifty's builtin classes and constructors as Node does"
created: 2026-11-23
why: A callback on a rifty stream reports `at publishedConstructor.onData` and a thrown or inspected `TextEncoder` prints `TextEncoder2 {}`; Node prints `Readable.onData` and `TextEncoder { … }`
epic: node-file-entry-parity
blocked_by: []
sources: [docs/backlog/epics/node-file-entry-parity/goal.md, docs/backlog/runtime-js/reference/guest-builtin-names-baseline.md, docs/adr/runtime-js/0571-prove-node-file-entry-and-fatal-report-parity-against-live-node-node-s-report-in-the-isolate-guest-only.md]
code: [packages/io/src/streams/callable-constructor.ts, packages/isolate-host/tests/bundle-public-names.test.ts, tests/browser-unit/fixtures/node-file-programs.ts]
---

## Context

Observed defect (RDY-8: contract = live Node v24.16.0; baseline and RED in
`runtime-js/reference/guest-builtin-names-baseline.md`), found by the CLOSE
review of PR #425 after the `EventEmitter2`/`Stream2` fix. One fault
class, `sibling-drift` between a builtin's source name and Node's public name:
V8 frames and inspect print the constructor's source name. Two producers: the
generic stream constructor (`function publishedConstructor`, one for
`Readable`/`Writable`/`Duplex`/`Transform`/`PassThrough`) and the bundler's
rename of a class or function bound to a name another binding holds
(`TextEncoder2 = class`, `DOMException2`; PR #425's check sees only
`function`/`class Name<digit>` declarations). The `.name` of builtin functions
outside the report (113 of 404 differ, 39 bundler suffixes) is the baseline's
second table; this unit closes what the fatal report prints.

## Challenge

challenge: 2026-11-23 — inherits the goal premise check (`goal.md` §Challenge)

## Acceptance

1. Isolate corpus rows (live Node oracle): a throw in a `'data'` listener of
   a `Readable`, in a `Writable` `write` option, a `Transform` `transform`
   option and a `PassThrough` listener print Node's frame names
   (`Readable.onData`, `Writable.write [as _write]`,
   `Transform.transform [as _transform]`, `PassThrough.onData`) → I3
2. Isolate corpus rows: `throw new TextEncoder()` and an error prop holding a
   `TextDecoder` and a `DOMException` print Node's constructor names → I2
3. A check fails on any class or function in the guest bundle whose source
   name is a Node builtin export or global plus a bundler suffix, declaration
   or bound expression (`X2 = class`, `function x2`), with no text-window
   exception → I3

## Out of scope

- `.name` of builtin functions the report does not print as a constructor
  (`path.dirname` `dirname2`, `setTimeout` `setTimeout2`, rifty's own names
  where Node has `wrappedFn`): `runtime-js/builtin-function-names`, compat
  isolate-host.md "Builtin function names".
- The browser hosts' bundles (`Server2`, `Worker2`, `setTimeout2`,
  isomorphic-git's `Buffer2` in Workbench chunks; baseline §Workbench): their
  fatal path prints as main (goal amend 2026-11-23). PR #425's `Server` fix
  was withdrawn there: its check scanned these bundles only when built, and
  no CI lane builds them. A check that covers them proves a vendor name
  unreachable by the guest (prod build), never by a text window around it.

## Decisions
