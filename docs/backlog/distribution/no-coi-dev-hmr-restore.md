---
area: distribution
status: ready
title: no-COI resident installed bin supports HMR and explicit whole-realm restart
created: 2026-08-28
epic: no-coi-sandbox-tier
why: build-to-completion works, but the public sandbox cannot start a resident installed bin, mount its preview, restart a wedged realm or report an unacknowledged write
user_story: As an agent platform, I want a resident installed dev tool with HMR preview and an explicit restart after my timeout detects a wedge
sources: [ADR-0377, docs/backlog/distribution/reference/no-coi-hmr-spike-record.md, docs/backlog/distribution/reference/no-coi-dev-hmr-restore-evidence.md]
code: [packages/rifty/src/sandbox.ts, packages/runtime-js/src/host.ts, packages/runtime-js/src/protocol.ts, packages/workbench/src/workers/no-coi-toolchain-worker.ts, tests/no-coi/no-coi-dev-hmr.spec.ts]
---

## Context

All I1/I2/I3/I5/I7/I9 prerequisites are certified. The current public Worker
can install and run a bin to completion, but has no resident-port operation,
page preview wiring or restart surface. The durable spike proves real Vite
7.3.6 HMR works in this one realm and that an infinite plugin loop leaves the
Worker alive-but-blocked; only page-side termination plus iframe reload
recovers it.

The destination stays package-generic. Vite supplies proof bytes only.
Heartbeat, journal, automatic reconnect/retry and crash durability remain
outside tier `works`.

## Challenge

challenge: 2026-08-28 — 2 problems
- A Worker-death event cannot detect the flagship alive-but-blocked wedge.
- Original HMR/recovery numbers lived on a throwaway branch.

Disposition: goal I6 makes wedge detection caller-owned and requires an
invokable restart; actual death is a separate event. The complete spike facts
are in `distribution/reference/no-coi-hmr-spike-record.md`.

## User scenario

On one real headerless Chromium page, the agent writes and installs a Vite 7
project, starts its installed bin, loads the SW preview, writes+flushes an
update and sees HMR without reload. A real plugin wedge blocks the realm; the
agent's timeout invokes restart with a repair callback and preview target. One
new Worker restores the resident tool, reloads the iframe and resumes HMR.

## Reference contract

- ADR-0375: one generic Worker/VFS/runtime; no Vite identity policy.
- ADR-0376: one fail-fast finite operation slot and exact peer settlement.
- ADR-0377: resident start, host activation snapshot, page preview bridge,
  explicit restart, death event and unflushed marker.
- Spike: Vite HMR stable bootId; wedge stays alive; terminate+reboot works;
  existing WS needs iframe reload; pending tree consistency is not promised.
- Baseline probe: installed no-COI Vite CLI is unpatched
  (`viteCliPatched:false`); resident support cannot depend on COI Workbench
  Vite preparation.

## Acceptance

1. Public `startBin({cwd,binPath,args,port})` exact-validates and snapshots the
   request, starts one caller-selected installed bin in the existing Worker,
   waits for that port and returns its `/preview/<port>/` URL. A request-
   identical non-Vite server works; identity/version never selects policy.
   → I4, ADR-0377
2. Real Vite 7.3.6 boots with the page and Worker non-COI. The SW-served iframe
   renders marker A; acknowledged `fs.writeFile` renders marker B through HMR
   with the same random bootId and no full reload. → I4
3. A real Vite plugin infinite loop makes a new public fs request remain
   pending without a runtime `exit:error` event. Caller-invoked restart terminates
   it, restores exact activation without npm/network, runs `beforeStart`,
   restarts the resident bin, assigns a new iframe URL and resumes one further
   same-bootId HMR update. → I6, scenario
4. Actual Worker `self.close()` emits exactly one existing runtime
   `{type:'exit',reason:'error'}` event and pending calls reject. Explicit
   restart emits reset; dispose emits nothing. → I6, ADR-0377
5. Restart after a pending public write reports `unflushedWrites:true` on the
   next boot; a restart after every write acknowledgement reports false. No
   tree consistency, rollback or recovery is claimed. → I10, ADR-0377
6. The committed no-COI Chromium lane proves I1–I7, I9 and I10 together on a
   document that stays `crossOriginIsolated===false`; capability report marks
   `toolchain.dev-hmr` working. → I8

## Parity cases

1. Vite and a request-identical ordinary HTTP bin reach the same start/port/
   preview lifecycle; installed bytes alone determine behavior. Artifact:
   Worker unit plus Chromium fixture. → ADR-0377
2. Initial load→HMR→wedge→restart+iframe reload→HMR exposes exact Worker,
   document and bootId generations. Artifact: Chromium timeline. → I4, I6
3. Pending-write termination and acknowledged-write restart differ only in
   the boot marker. Artifact: host unit and Chromium recovery. → I10

## Fault matrix

| axis × operation | honest outcome | reproducible artifact / fault target |
|---|---|---|
| `provenance-lie` × resident start | Vite/non-Vite identical requests follow installed bytes | identity-decoy Worker/Chromium matrix → ADR-0377 |
| `observable-order` × ready/restart | port precedes start result; activation+repair+resident precede iframe assignment | held-step unit + Chromium timeline → I4, I6 |
| `false-fallback` × resident/pending calls | unexpected death emits once and settles; wedge emits none until explicit restart | real Worker close+wedge carrier → I6 |
| `torn-state` × generation replacement | pending public write sets next-boot marker; acknowledged sibling stays clean | delayed-write host/Chromium pair → I10 |
| `concurrent-same-key` × restart | one host generation owner rejects overlap; no queue/retry/second Worker survives | host unit + Worker-count carrier → ADR-0377 |

## Out of scope

- No heartbeat or automatic wedge detection; caller timeout owns detection.
- No automatic WS reconnect: restart visibly assigns a new iframe URL.
- No journal, rollback, transaction, exactly-once, hidden retry or crash-proof
  workspace durability.
- No COI Workbench child process fabric or Vite-specific product branch.
- No resident build concurrency, stdin/cancel/stop API or multi-resident realm.

## Decisions

review: checkpoints rounds:2
contract-red: round 1 — blocker @ 54ed1f153
re-cut: 2026-09-04 — compiled the final I4/I6/I10/I8 product slice and removed obsolete prerequisite history — trace: none
- 2026-09-04 — expected RED band 4–4: public start/preview, real HMR, wedge restart/dirty marker, actual-death/overlap siblings.
