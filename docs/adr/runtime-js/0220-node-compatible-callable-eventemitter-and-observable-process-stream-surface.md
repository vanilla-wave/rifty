# ADR 0220: Node-compatible callable EventEmitter and observable process stream surface

Status: Accepted
Date: 2026-07-10

> TL;DR: Publish the Node-observable callable `EventEmitter` and `Readable`
> producer/paused contract, use that `Readable` for `process.stdin`, resolve
> public node-entry paths against `cwd`, and expose one explicit reset boundary
> for the in-process parity harness.

## Context

Real `nodemon@3.1.14` forced four Node contracts that were independently close
enough to pass shallow shape tests but wrong for real packages:

- legacy constructors call `EventEmitter.call(this)` before `util.inherits`;
  an ES class throws there;
- `readdirp`/`chokidar` subclasses `Readable` and overrides `_read()`; rifty's
  constructor-only private producer left that stream idle;
- supervisors treat `process.stdin` as a real `Readable`, including passive
  `unpipe`, `pause`, and `isPaused` behavior;
- `spawn('node', ['relative.js'], { cwd })` resolves the entry against the child
  cwd, while the public `runNodeEntry` seam previously documented absolute-only
  input.

These are observable package APIs. `@riftydev/io` publishes `EventEmitter` and
`Readable`, `@riftydev/runtime-js/builtins` re-exports them, and
`@riftydev/runtime-js/builtins/process` plus `./builtins/node-entry` are stable
subpath exports under ADR-0018/0157. Treating the changes as private fixes left
an irreversible public-surface decision unrecorded.

The Node parity runner adds one lifecycle constraint: unlike real Node, it runs
many cases against one module-cached no-spec `riftyProcess`. After one case ends
stdin, the next needs a fresh stream as a unit; mutating selected decoder,
listener, buffer, and flowing fields would be another partial stream shim.

## Decision

1. `EventEmitter` is one exported function object with call and construct
   signatures. `EventEmitter.call(target)` is a valid legacy initializer;
   `new EventEmitter()`, subclassing, prototype identity, `instanceof`, static
   defaults, and symbols use the same implementation.
2. `Readable.prototype._read(size)` is the single producer hook. A constructor
   `read` option replaces that same hook, otherwise subclasses override it. A
   demanded bare `Readable` fails with Node's `ERR_METHOD_NOT_IMPLEMENTED`
   instead of idling. `Readable.prototype.isPaused()` reports explicit paused
   state.
3. `NodeProcess.stdin` is the shared `Readable`, not a Readable-like
   `EventEmitter`. One installer owns the stream and its matching host push
   bridge. ADR-0217 separately decides whether a spawned worker receives
   forwarded stdin or the terminal-only loud unavailable guard.
4. Keep `resetRiftyProcessStdinForTest()` on the already-public
   `./builtins/process` host surface. It replaces stdin only on the no-spec
   singleton and atomically replaces the matching host push bridge. It is not
   installed on user-visible `node:process`, does not reset seeded child
   processes, and is not a general process restart API.
5. `runNodeEntry({ entryPath, cwd })` accepts an absolute or relative VFS path;
   one path boundary resolves relative input against `cwd` before loader/bin
   handling. This is the same rule used by `spawn` and `fork`; absolute input is
   unchanged.

Rejected:

- Keep an ES-class-only `EventEmitter` and special-case nodemon: fake package
  compatibility, and other `util.inherits` consumers still fail.
- Keep a private Readable producer alongside `_read`: two semantic owners drift
  for constructor and subclass streams.
- Reset selected stdin internals in the parity runner: decoder, EOF, buffer,
  flowing state, and listeners can produce torn stream state.
- Reload the process module or spawn a host process per parity case: ESM module
  identity prevents the former; the latter replaces a narrow deterministic
  harness boundary with process orchestration.
- Keep `runNodeEntry` absolute-only and resolve in each caller: spawn, fork,
  direct node entry, and `.bin` execution can drift.

## Consequences

- Legacy and modern event consumers share one identity; real nodemon's
  dependency graph can initialize without a package-specific adapter.
- Readable producers, process stdin, and HTTP push streams share the same
  buffering/flow/error contract and parity tests.
- `resetRiftyProcessStdinForTest` is intentionally stable public host surface;
  its test-specific name and no-spec-only contract are permanent API cost.
- A bare `Readable` now fails on demand where the old implementation could stay
  silently idle. Push-driven internal streams must declare a no-op `_read`.
- Relative node-entry acceptance widens the public subpath behavior without
  changing the option type.
- No external dependency or layer reversal is introduced.

## Acceptance criteria

- Legacy call/inherits and modern subclass EventEmitter cases match Node 24.
- Prototype `_read`, constructor `read`, missing producer, and `isPaused` match
  Node 24.
- Sequential parity cases receive independent stdin decoder/EOF/listener state.
- Relative child entries resolve from `cwd`; absolute entries are unchanged.
- `@riftydev/io`, `@riftydev/runtime-js/builtins`, and the two runtime-js
  subpaths retain their declared TypeScript surfaces.

## References

- ADR-0012 — `@riftydev/io` owns shared Node primitives.
- ADR-0018 — runtime-js built-in subpaths are stable public API.
- ADR-0034 — active stream-contract decision, corrected by this ADR.
- ADR-0157 — unified `NodeProcess`, corrected by this ADR and ADR-0217.
- ADR-0217 — explicit worker stdin/runtime-IPC capabilities.
