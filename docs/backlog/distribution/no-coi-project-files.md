---
area: distribution
status: ready
title: Structured no-COI project filesystem operations
created: 2026-09-10
why: Embedded agents must list and mutate the worker-owned project without eval strings or temporary result files
user_story: As an embedder, I want my agent to list, inspect, create, edit, rename and remove project files through the SDK, but RuntimeFs exposes only readFile and writeFile.
sources: [https://github.com/vanilla-wave/rifty/issues/325, ADR-0131, ADR-0375, docs/backlog/distribution/reference/issues325-326-refine-evidence.md]
code: [packages/rifty/src/sandbox.ts, packages/runtime-js/src/host.ts, packages/runtime-js/src/worker-fs-rpc.ts]
---

## Reference contract

ADR-0418 fixes the additive public shape. Node/VFS and native Worker evidence,
RED commands and shared packed-consumer scenarios:
`docs/backlog/distribution/reference/pr-331-implementation-evidence.md`.

## Challenge

challenge: 2026-09-10 — clear; unchanged accepted premise/scope reused from
`docs/backlog/distribution/reference/issues325-326-methods-final-green.json`.

## Context

#325 reports a static audit of published 0.7.0, not a reproduced regression.
The checked source revision still exposes only read/write. Worker eval prints
the expression value, then returns `value: undefined`. Workbench has broader
project operations, but its COI owner/session topology cannot serve this SDK.
Evidence and source snapshots: `reference/issues325-326-refine-evidence.md`.

## User scenario

A packed SDK host without COI opens a real project, lists directories, reads
file metadata/content, creates a directory/file, edits, renames and removes it.
It uses public methods and structured results; no guest-source construction,
private Worker global, stdout parsing or temporary project/control file.

The same project is used by the command surface in
`distribution/public-api-ai-agent-exec-preview`; its configured project paths
and readonly policy must agree with the file tools.

## Acceptance

- Public read/write plus listing, stat, mkdir, rename and removal operate on the same real Worker VFS as guest programs, through a packed consumer. → scenario
- Existing raw `RuntimeFs` paths remain VFS-rooted, independent of mutable guest cwd; project-scoped file/command use agrees on the configured root and readonly paths. → scenario, ADR-0131
- Mutations settle with honest applied/persistence information; failed OPFS writes and Worker termination never become success or proof of no effect. No cancellation rollback or hidden retry claim. → scenario
- Public eval documentation/types explicitly describe console-oriented evaluation and its result; structured file results and command outcomes require no temporary files. → scenario

## Fault matrix

Boundary models: dedicated Worker and storage (`fault-classes.md`). Alive
MessagePort loss/replay/reorder is excluded; no transport retry machinery.

| Reachable fault | Required observation | Trace |
|---|---|---|
| quota-perm-fail / torn-state during mkdir, write, rename, remove or flush | Explicit failure; any applied or uncertain effects remain distinguishable from durable success | → scenario |
| peer death after admission, before reply | Termination/unknown outcome; no inferred non-application or replay | → scenario |
| malformed path/options, missing entry, readonly destination | Honest operation error, consistent path semantics across file and command interfaces | → scenario |

## Decisions

ready-verdict: 2026-09-10 — Contract+RED @ 110c8ecf940f95cd6b0a89b9ab8d39dc4d5a9027

- 2026-09-10 — #325 permits explicit console-only eval; typed FS plus #326 command outcomes close the supplied scenarios without a general JS-value API.
- 2026-09-10 — raw root anchoring follows ADR-0131; project binding must be additive, never reinterpret existing raw read/write paths.
- 2026-09-10 — method names, stat/list result shape and shared composition seam remain agent-owned at PICKUP; public API needs an ADR and reference/RED evidence before implementation.
- rejected route: eval-based FS shim — violates the scenario and ADR-0131's control-plane ownership.
- rejected route: page-side VFS or complete Workbench facade — violates the single Worker authority / no-COI scenario (ADR-0375/0377).

## Out of scope

General JS structured evaluation, new filesystem capabilities beyond the named
operations, hostile-code security isolation and crash-atomic workspace recovery.
These are not approximated by successful placeholders. Existing runtime gaps
retain their loud errors and compatibility status. No Node parity is claimed
by this draft; PICKUP proves any adopted Node-shaped semantics.
