---
kind: epic
status: ready
title: Real Node server dev loop — edit, restart, recover
created: 2026-07-17
value: A developer runs a real Node server under real nodemon in the browser; source edits replace the app faithfully on the same preview port, including crash recovery and teardown.
user_story: As a developer using Express, Hono, or Koa in rifty, I want `npm run dev` to run real nodemon so edits restart my app and preview automatically, but today the server keeps stale code until I stop and rerun it.
tier: robust
sources: [ADR-0150, ADR-0174, ADR-0225, ADR-0230, ADR-0257, ADR-0265, ADR-0267, ADR-0278, ADR-0324, ADR-0325, ADR-0326, ADR-0327, Node-v24.16.0-probe, nodemon-3.1.14-reachability]
---

## Outcome

Express, Hono, and Koa use installed `nodemon@3.1.14` as their development
supervisor. Nodemon runs in a supervised Node Worker, forks the application in
a fresh child Worker over the same owner-backed VFS, and publishes only the
terminal output, exits, and routed HTTP responses that the real processes
produce. There is no Playground watcher, synthetic restart log, template-ID
dispatch, direct-node fallback, or readiness inferred from stdout.

The curated servers are the forcing proof for reusable Node behavior: callable
EventEmitter construction, CJS module identity, recursive Worker spawn/fork,
owner-visible process identity, Node stdio/default-JSON IPC, finite process
discovery/signalling, shared files, final-output drain, exact exit, and
same-port replacement must agree with Node before rifty claims this loop.

`tier: robust` was user-confirmed on 2026-07-26. Every fault reachable during
the current owner session must settle honestly. Reconstructing nodemon, its app
descendant, or preview routing after browser/owner crash or reload is not
promised.

## User scenario

A developer opens Express + SQLite and runs `npm run dev`, which executes the
installed package with
`nodemon --legacy-watch --no-stdin --no-update-notifier src/main.js`. The
terminal shows nodemon's own output; preview becomes ready only after a routed
HTTP response from the app child.

Editing `src/main.js` terminates the old app Worker, starts a fresh Worker, and
serves the edited response on the same preview port. Realm-local SQLite state
resets, proving replacement. Invalid syntax produces the real crash on stderr;
a later valid edit recovers without rerunning `npm run dev`. Rapid edits
converge on final owner-VFS bytes. Ctrl-C, project switch, or session close
terminates nodemon and every descendant without a queued watch resurrection.
Hono and Koa each complete the same-port edit/restart path through the same
substrate.

## Invariants

1. I1. In Express + SQLite, `npm run dev` executes installed
   `nodemon@3.1.14` with
   `--legacy-watch --no-stdin --no-update-notifier src/main.js`; no custom
   watcher or direct-Node fallback runs, terminal output comes from the real
   package/processes, and preview becomes ready only after a routed app
   response.
2. I2. Editing `src/main.js` replaces the app Worker on the same preview port,
   serves the edited bytes, and resets realm-local SQLite state.
3. I3. Invalid syntax produces the real app crash on stderr; a later valid edit
   restores the same dev run without rerunning `npm run dev`.
4. I4. Rapid edits converge on final owner-VFS bytes with exactly one live app
   descendant and no stale preview route or port holder.
5. I5. Ctrl-C, project switch, and session close terminate nodemon, every
   descendant, process/control channel, and preview ownership exactly once; an
   admitted or queued watch event cannot resurrect the subtree.
6. I6. Hono and Koa each complete one same-port edit/restart through the same
   substrate; Express completes the full start, edit, state-reset,
   crash/recovery, rapid-edit, and teardown journey.

## Items

1. `playground/node-server-restart-on-edit` — **full-feature** — sole substrate
   and acceptance owner: legacy EventEmitter/CJS compatibility, recursive
   Worker child semantics and owner-VFS provenance, private descendant
   lifecycle control, Workbench selection/preview ownership, and browser proof.

One deep item is intentional: the user requires the complete feature in one
source PR, and the autonomous-goal gates admit exactly one selected item/slice
per source PR. Required discoveries remain inside this item's ready boundary;
outside-goal findings use normal backlog intake.

## Budget

Run tripwires (`docs/backlog/README.md` §Budget):

- scope implemented outside `ready` items: 0
- in-place ready-contract edits alongside source changes: 0
- new coordination mechanisms: 0, substrate: `playground/node-server-restart-on-edit`
- review checkpoints per slice: exactly 2
- generated globs: `docs/public/compat/**`, `pnpm-lock.yaml`
- slices:

| slice | band |
|---|---|
| full-feature | 1000–3000 |

## Decisions

ready-verdict: 2026-07-26 — Outcome and I1–I6 are fixed by the pinned Node 24.16.0/nodemon 3.1.14 primitive and native-loop probes; ADR-0324–0327 settle EventEmitter, CJS-record, federated process/control, and exact-script-selection forks; robust current-session fault scope and the reload boundary are explicit; one reverse-linked full-feature item owns the complete mechanism sweep and acceptance with one budget slice; no stale or overlapping epic residual remains.

- User-confirmed tier is `robust`; browser/owner crash-or-reload
  reconstruction remains outside the frozen outcome. Current-session owner
  death visibly invalidates readiness/routes and cannot fabricate recovery.
- Exact forcing consumer is installed `nodemon@3.1.14` with the lock/integrity
  evidence in
  `docs/backlog/playground/reference/nodemon-3.1.14-reachability.md`.
- ADR-0324 and ADR-0325 put legacy construction and CJS metadata on their
  existing state owners. ADR-0326 makes ProcessManager the federated tree owner
  and separates optional public JSON IPC from private control. ADR-0327 makes
  exact script bytes select the existing Workbench paths.
- The former callable-EventEmitter, CJS metadata, generic Worker remote-FS, and
  Worker child-process drafts are absorbed by the sole item. The false
  `process.stdin.unpipe()` premise and same-realm queued-kill sibling are
  excluded.

## Out of scope

- Browser/owner crash or reload reconstruction.
- Playground watcher, synthetic nodemon output, direct-entry fallback,
  template-ID runtime branch, or a second lifecycle/preview/process owner.
- General shell/process groups/job control, arbitrary `ps`/`kill`, `/proc`,
  arbitrary numeric descriptors, advanced IPC serialization/handle transfer,
  and public channel `ref()`/`unref()`.
- General `process.stdin` pull/pipe/unpipe/raw/async-iteration parity; the exact
  `--no-stdin` journey does not call it.
- Full binary stdio backpressure, `require.cache` facade/delete/reload,
  same-realm queued-handler kill cancellation, and Vite/HMR changes.
