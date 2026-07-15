# ADR 0267: Entry-scoped host bootstrap metadata for recursive Node workers

Status: Accepted
Date: 2026-07

> TL;DR: recursive Node entries receive versioned host bootstrap + fresh launch
> metadata on their exact URL entry; `process.env` stays guest-owned.

## Context

ADR-0231 made recursive workers survive Node's replacement `env` semantics by
merging host runtime URLs and operation flags into the guest environment. It
called that channel opaque/process-internal, but the kernel seeds the same record
as public `process.env`. Real Node 24 with `new Worker(..., {env:{FOO:'1'}})`
exposes exactly `{FOO:'1'}` in the child; rifty exposed extra `RIFTY_*` keys.

The contradiction became observable under Vite 8. A Vite child started with
bin/serve/Vite/preview flags; Rolldown faithfully used
`new Worker(wasiWorker, {env:process.env})`; the pthread inherited those flags
and `node-entry-bootstrap` misclassified `wasi-worker.mjs` as Vite. Preparation
threw, the pthread exited, and preview readiness hung. Fault class:
`sibling-drift` (execSync refreshed role while worker_threads inherited it) plus
`frozen-assumption` (tests pinned host-key precedence, not Node's exact env).

Filtering known keys is not a class-kill: the next control key repeats the bug.
Kernel must remain runtime-agnostic (ADR-0039), while runtime-js needs an ordered
pre-entry channel distinct from user-visible Node state.

## Decision

Keep three records separate:

1. **Guest env** — the exact inherited/replacement Node environment. No host
   bootstrap or launch key is added, removed, or reinterpreted. A guest key named
   `RIFTY_BIN` remains ordinary guest data and cannot select a bootstrap role.
2. **Host bootstrap** — an opaque, structured-cloneable host snapshot configured
   with the node-entry URL and propagated unchanged to recursive children.
3. **Launch metadata** — a fresh discriminated role for every spawn: program
   (module/bin, run/serve, remote-fs, PTY, preview scope) or worker-thread
   (thread identity/data, remote-fs). Parent command role is never inherited.

URL `WorkerEntryDescriptor` gains an optional versioned bootstrap envelope
`{protocol, payload}`. It travels atomically with the existing kernel `init`
message and is published on a non-enumerable kernel global before the pre-entry
hook. Kernel transports it opaquely; runtime-js owns the Node envelope;
Playground validates its host payload as `NodeWorkerRuntimeConfig` and owns
preview/tool refinement.

`configureNodeEntryWorker` stores URL + host bootstrap, not an env overlay.
Every owner bin/node spawn, execSync recursive spawn, and `worker_threads` spawn
uses one builder/validator. Missing, malformed, wrong-version, or wrong-protocol
metadata throws before user entry. Migration is atomic: no env fallback or
dual-read compatibility path.

Derivable identity is not transported. Vite preparation requires the exact
executed `node_modules/.bin/vite` and derives its mode from argv. The exact-entry
guard remains defence in depth even though a nested worker no longer receives a
Vite launch role.

Rejected:

- delete/override reserved env keys per spawner — visible env remains wrong;
  exhaustive-list drift repeats the class;
- metadata on `KernelProcessSpec` — pollutes process identity with an unowned
  option bag and detaches role from its entry;
- dedicated URL per role — multiplies bundle/deployment wiring and still needs
  data transport;
- a second IPC handshake — adds ordering/race machinery before entry although
  the ordered init message already exists;
- hide keys only while constructing `NodeProcess` — leaves one record with two
  semantics and bootstrap still depends on collisions.

## Consequences

- (+) Node inherited/replacement env is faithful and nested workers cannot inherit
  their parent's host role.
- (+) One versioned entry boundary owns validation; kernel learns no Node/Vite
  semantics; ADR-0039/0150/0155/0157 remain intact.
- (+) Vite→Rolldown pthread receives a worker-thread launch and real guest env;
  exact-entry validation turns stale/malformed metadata into a loud failure.
- (−) Public kernel descriptor and runtime-js node-entry configuration semantics
  change; every node-entry spawner migrates in one cut.
- (−) Host bootstrap must be structured-cloneable and versioned. A future shape
  change requires a new protocol version, never permissive option-bag growth.
- Supersedes ADR-0231. Product/operator settings intentionally exposed as env
  remain env; this decision covers host bootstrap and process-launch control.
