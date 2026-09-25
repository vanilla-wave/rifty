# ADR 0449: Carry Node startup options on fork and Worker launches; expose Worker stdio streams

Status: Accepted
Date: 2026-09

> TL;DR: `fork` and `worker_threads.Worker` compile their effective `execArgv`
> through one startup-options compiler that honours Node's `-r`/`--require`,
> `-C`/`--conditions` and `--experimental-import-meta-resolve` and names every
> other token in a `NotImplementedError`. node-entry goes v5 → v6 so program and
> worker-thread launches carry the exact tokens; the child installs them as one
> realm-scoped record before any loader exists. A Worker gets Node's
> `stdout`/`stderr` Readables, piped into the parent's process streams unless
> `stdout: true` / `stderr: true`. Corrects ADR-0448's active v5 version.

## Context

vitest 4.1.11 starts every pool child with a non-empty `execArgv`
(`--experimental-import-meta-resolve`, `--require <vitest>/suppress-warnings.cjs`,
`--conditions node`, `--conditions development` with vite 8.0.16):
`fork(entry, [], { env, execArgv, stdio: 'pipe', serialization: 'advanced' })`
and `new Worker(entry, { env, execArgv, stdout: true, stderr: true })`, then
`child.stdout.pipe(...)`. rifty's Worker throws `worker_threads.Worker.execArgv`
for any own `execArgv`, has no `stdout`/`stderr` (a worker's output is lost),
and `fork` drops `execArgv` silently. Oracle and consumer facts (Node v24.16.0):
`docs/backlog/runtime-js/reference/worker-threads-stdio-streams-empty-exec-argv-evidence.md`.

## Decision

1. **Worker stdio** (Node `lib/internal/worker.js`). `stdout`/`stderr` are
   `node:stream` Readables created with the Worker and fed by the kernel
   worker's existing output streams (no new transport). Without
   `stdout: true` / `stderr: true` they are piped into the owner's
   `process.stdout` / `process.stderr`, which the pipe never ends (ADR-0458).
   Every chunk the worker wrote is pushed before `'exit'`; both streams end
   right before `'exit'` is emitted, so `'end'` follows it. `stdin` is `null`;
   `stdin: true` is `NotImplementedError('worker_threads.Worker.stdin')`. The
   non-Node `'stdout'`/`'stderr'` Worker events are removed.
2. **One compiler.** Accepted tokens: `-r <s>`, `--require <s>`,
   `--require=<s>`, `-C <c>`, `--conditions <c>`, `--conditions=<c>`,
   `--experimental-import-meta-resolve`. A flag without its own operand (absent,
   starting with `-`, or an empty `=` value): for a Worker Node's
   `ERR_WORKER_INVALID_EXEC_ARGV` (`<flag> requires an argument`); for `fork`
   `NotImplementedError('child_process.fork.execArgv')` naming the flag. (Node's
   fork appends the module path after `execArgv`: an absent operand takes it —
   `-r`/`--require` preloads the module, `-C`/`--conditions` makes it a
   condition — and the entry-less child runs its stdin program; the other two
   exit the child 9, evidence §fork operands.)
   Any other entry (another flag, `-r=x`, a non-string) is
   `NotImplementedError('worker_threads.Worker.execArgv' | 'child_process.fork.execArgv')`
   naming the token quoted. All of this throws before a thread id, hold, child
   or spawn exists.
3. **Effective `execArgv`.** Worker: a truthy `options.execArgv` (a non-array is
   Node's `ERR_INVALID_ARG_TYPE`); falsy or omitted inherits the parent
   thread's startup tokens from its launch (Node's trusted snapshot: a mutated
   public `process.execArgv` does not change it). `fork`: Node's
   `options.execArgv || process.execArgv` with the owner's public array at the
   call; when the result is that array itself (omitted, falsy, or passed
   explicitly) Node's eval pair is removed from a copy (the last occurrence of
   the launch's eval source and the switch before it); any other array is
   taken as given. `spawn` ignores `execArgv`, as in Node. An inherited
   eval switch (`node -e "new Worker(...)"`) is an unaccepted token, so it stays
   the named throw of draft `runtime-js/worker-threads-inherited-exec-argv`.
4. **node-entry v6.** Program and worker-thread launches gain an optional
   exact-own `execArgv` string array (omitted ≡ `[]`). Under ADR-0267's version
   rule `rifty.node-entry/v5` becomes `v6` atomically, no v5 reader (ADR-0416,
   ADR-0448 precedent). The decoder re-runs the compiler: a token it rejects is
   a protocol error, never a silently different child.
5. **Child startup.** Before any loader exists, the node-entry bootstrap
   compiles the launch tokens into one realm-scoped record (a `Symbol.for` key,
   shared by every bundle copy in the realm). `process.execArgv` is a copy of
   the tokens. The resolver's condition set is Node's defaults plus the user
   conditions for every resolution in the realm (require, `require.resolve`,
   static and dynamic import, `import.meta.resolve`, package `imports`).
   `import.meta.resolve(specifier, parent)` honours `parent` (string or URL;
   an unparsable one is `TypeError` `ERR_UNSUPPORTED_RESOLVE_REQUEST`) only
   with the flag; without it Node 24 ignores the argument. Preloads run in
   order through the entry loader's CommonJS `require` from a synthetic
   `internal/preload` parent at the child's cwd, after the conditions are
   active and before the entry, with `require.main` unset; this lives in
   runtime-js `runNodeEntry`, shared by the Workbench bootstrap and the parity
   adapter. A preload failure is the entry's failure.
6. **Same-realm fallbacks** (no SAB or no kernel URL) cannot give a child its
   own realm: a non-empty effective `execArgv` is
   `NotImplementedError('worker_threads.Worker.execArgv.same-realm' | 'child_process.fork.execArgv.same-realm')`;
   a same-realm Worker's output shares the parent streams, so `stdout: true`,
   `stderr: true` and reading `stdout`/`stderr` are
   `NotImplementedError('worker_threads.Worker.stdio.same-realm')`.

## Rejected

- **Per-loader conditions option**: `createModuleLoader` instances made later in
  the realm (the same-realm Worker importer, `module.createRequire`'s
  last-writer publication) would resolve without them; Node's conditions are
  process-wide.
- **Wrapper entry / preloads resolved against the entry path** (draft #349):
  Node resolves preloads from the child's cwd (evidence `order-child-cwd`,
  `sub/pre.cjs`) and keeps `argv[1]`/`require.main` the real entry.
- **vitest-shaped allowlist** (draft #349 `worker-exec-argv.ts`): no `-r`/`-C`/`=`
  spellings, no inheritance; a package-shaped contract.
- **Carrying tokens in the child env** (a `NODE_OPTIONS`-like variable): host
  metadata leaves guest `process.env` (ADR-0267); Node's `process.execArgv`
  never contains `NODE_OPTIONS`.
- **Exposing the kernel handle's Readables as `worker.stdout`**: their end is
  the kernel's output drain, not Node's end-before-`'exit'` order, and in a
  production build they may be another bundle's io copy (traps
  prod-dual-copy-buffer).

## Explicit gaps

Named throws, listed in `docs/public/compat/modules.md`: every other startup
flag (`--import`, `--no-warnings`, `--experimental-vm-modules`, `--inspect`,
`-e`/`-p`, …), a `fork` flag without its own operand, Worker `stdin: true`, the
same-realm cases above. Not claimed (compat ⚠️): the order between a worker's
stdout and its `'message'` events (Node varies, evidence §Stdio), and the port
hold an `unref()`'d Worker's read `stdout: true` stream takes in Node. A
failing preload in a Worker exits 1 without Node's `'error'` (compat ❌, the
existing kernel-path `'error'` gap `runtime-js/worker-threads-kernel-error-event`).

## Consequences

- vitest's pool children start with Node's options through one generic path;
  nothing vitest-shaped.
- Deploy matching Worker assets together; a v5 bundle rejects a v6 launch.
- DEC-2: corrects ADR-0448's active node-entry v5 version (dated note there);
  follows ADR-0267's version rule and leaves ADR-0339's eval-CLI preload gap
  (`workbench.node.preload-context`) unchanged.

## References

- ADR-0267, ADR-0339, ADR-0416, ADR-0446, ADR-0448, ADR-0458
- `docs/backlog/runtime-js/worker-threads-stdio-streams-empty-exec-argv.md`
