/**
 * Guest bundle entry (ADR-0557 §4): one rifty runtime in one isolate, one
 * `node -e` run. Lifecycle = the kernel's run-to-completion child:
 * `runNodeEntry({kind:'eval'})` → `awaitDrain` → natural `exit()`; a
 * `RIFTY_PROCESS_EXIT` carries its code, any other throw is stderr + 1.
 */
import { NotImplementedError } from '@riftydev/io';
import { awaitDrain, registerBuiltin } from '@riftydev/runtime-js';
import { Buffer } from '@riftydev/runtime-js/builtins/buffer';
import nodeConsole from '@riftydev/runtime-js/builtins/console';
import { runNodeEntry } from '@riftydev/runtime-js/builtins/node-entry';
import {
  installProcessGlobals,
  riftyProcess,
  setProcessCwd,
} from '@riftydev/runtime-js/builtins/process';
import { installTimerGlobals } from '@riftydev/runtime-js/builtins/timers';
import {
  formatThrown,
  handleRealmUncaughtError,
  handleRealmUnhandledRejection,
  readNodeProcessTerminal,
  setDefaultProcessOutputSink,
} from '@riftydev/runtime-js/internal';
import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { syncMirror } from '@riftydev/vfs';
import { type MemoryFsSync, installMemoryFs } from '@riftydev/vfs/internal';
import { GUEST_DIRS, UNCOPYABLE_REJECTION } from '../contract.ts';
import { FsSnapshotError, type SnapshotOptions, restoreFs, snapshotFs } from '../snapshot.ts';
import { bindNotImplemented } from './loud.ts';
// Evaluated before every runtime module: the build injects it first (scripts/build-runtime.mjs).
import {
  bridge,
  fireTimer,
  installCeilingGlobals,
  onSettled,
  setUncaughtHandler,
  writeHost,
} from './web-shim.ts';

bindNotImplemented(NotImplementedError);

const CWD = '/workspace';
// The realm's FS exists from load, so a restore before `run` is the tree `run` sees (ADR-0567 §6).
installMemoryFs();
const guestFs = syncMirror() as MemoryFsSync;
for (const dir of GUEST_DIRS) guestFs.mkdirSync(dir, { recursive: true });
/** Guest code has started in this realm: no restore from here on. */
let started = false;
/** A restore failed after it began writing: the FS is partial, the isolate is done (ADR-0567 §6). */
let broken = false;
/** Codes `restoreFs` throws before it writes anything (and option `TypeError`s). */
const BEFORE_WRITING = new Set([
  'ERR_FS_SNAPSHOT_TOO_LARGE',
  'ERR_FS_SNAPSHOT_CORRUPT',
  'ERR_FS_SNAPSHOT_VERSION',
  'ERR_FS_SNAPSHOT_TEMPLATE',
]);

function refuseIfBroken(): void {
  if (broken)
    throw new FsSnapshotError(
      'ERR_FS_SNAPSHOT_INCOMPLETE',
      'a restore failed while writing; dispose this isolate',
    );
}
/**
 * Builtin modules `node -e` exposes as lazy globals (Node v24.16.0
 * `Object.getOwnPropertyNames(globalThis)` getters under `[eval]`); `process`
 * is already the global. A read requires the module, a write replaces it.
 */
const EVAL_BUILTIN_GLOBALS = [
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'net',
  'node:sea',
  'node:sqlite',
  'node:test',
  'os',
  'path',
  'perf_hooks',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
];

function installEvalBuiltinGlobals(): void {
  const loader = createModuleLoader(syncMirror(), { cwd: CWD });
  // node:crypto captured `subtle` at load from a webcrypto without it: name the gap.
  const cryptoModule = loader.require('crypto', `${CWD}/[eval]`) as Record<string, unknown>;
  if (cryptoModule.subtle === undefined) {
    Object.defineProperty(cryptoModule, 'subtle', {
      get: () => (cryptoModule.webcrypto as { subtle: unknown }).subtle,
      configurable: true,
      enumerable: true,
    });
  }
  for (const name of EVAL_BUILTIN_GLOBALS) {
    const replace = (value: unknown): void => {
      Object.defineProperty(globalThis, name, {
        value,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    };
    Object.defineProperty(globalThis, name, {
      get() {
        const value = loader.require(name, `${CWD}/[eval]`);
        replace(value);
        return value;
      },
      set: replace,
      configurable: true,
      enumerable: false,
    });
  }
}
/**
 * V8 messages by which Node 24 re-runs `-e` input with ESM syntax as a module
 * (detect-module). rifty's eval is CommonJS-only (backlog
 * runtime-js/node-cli-esm-eval-context): name the gap instead of a SyntaxError
 * Node would not raise.
 */
const ESM_SYNTAX: readonly string[] = [
  'Cannot use import statement outside a module',
  'await is only valid in async functions and the top level bodies of modules',
  "Unexpected token 'export'",
  "Cannot use 'import.meta' outside a module",
];
const EGRESS_MODULES = ['http', 'https', 'net'] as const;
/** rifty builds these on browser primitives this host lacks (CompressionStream, Workers + SAB). */
const HOST_CEILING_MODULES = {
  zlib: 'needs web CompressionStream, absent in the rifty isolate host',
  child_process: 'no child processes in the rifty isolate host',
  worker_threads: 'no Workers in the rifty isolate host',
} as const;

/**
 * The run's status, as this realm's runtime reports it (ADR-0557 §6).
 *
 * This realm is the guest's: every lookup here can be poisoned, so nothing it
 * returns is authority. The child validates the number in its own realm and
 * treats anything else (a throw, a garbage value) as a failed run, exit 1, with
 * no text of its own; a hang is the deadline's. What a guest can reach is
 * therefore its own status and its own text, never the consumer's view of the
 * host.
 */
function settle(caught: unknown): number {
  // The runtime's own terminal for this process; its `exitCode` is already
  // clamped by the runtime (`toUint8ExitCode`). A lookalike the guest threw is
  // not it, so a thrown `{code:'RIFTY_PROCESS_EXIT'}` cannot pick a status.
  try {
    const terminal = readNodeProcessTerminal(riftyProcess);
    if (terminal !== null) {
      const code = terminal.exitCode;
      // A primitive is all this realm hands over: the child judges its range.
      if (typeof code === 'number') return code;
    }
  } catch {
    // A broken lifecycle read is a failed run, not an exit.
  }
  writeDiagnostic(esmGapOf(caught) ?? caught);
  return 1;
}

/**
 * Node runs `-e` input with ESM syntax as a module; this host evaluates
 * CommonJS, so V8's syntax error means the declared gap. Total: a poisoned
 * `message` or `instanceof` leaves the original error.
 */
function esmGapOf(caught: unknown): Error | null {
  try {
    const message = (caught as SyntaxError).message;
    if (typeof message !== 'string') return null;
    if (!ESM_SYNTAX.some((m) => message.includes(m))) return null;
    return new NotImplementedError(
      'isolate-host.node-eval-esm',
      'Node runs -e input with ESM syntax as a module; this host evaluates CommonJS only — use require()',
    );
  } catch {
    return null;
  }
}

/** Write the guest's error with the runtime's own fatal text (`formatThrown`); never throws. */
function writeDiagnostic(error: unknown): void {
  try {
    writeHost(2, `${formatThrown(error)}\n`);
  } catch {
    // The guest broke its own diagnostic: nothing is written, the status still crosses.
  }
}

/** The runtime's own `process.exit`, captured before guest code can replace it. */
let nativeExit: () => void = () => {
  throw new Error('isolate-host guest: exit before the runtime was installed');
};

/**
 * An uncaught error the runtime did not claim (no eval lifecycle): Node's fatal
 * exit. The status rides the run's own return value, so this only reports the
 * text and lets the drain end the run.
 */
function fatal(error: unknown): void {
  writeDiagnostic(error);
  nativeExit();
}

/**
 * One run of the runtime: `launch` starts the entry, then the drain and the
 * natural `exit()`, as `node` does. Resolves with the status, a primitive only.
 */
function runToExit(launch: () => Promise<void>): Promise<number> {
  refuseIfBroken();
  started = true;
  // Resolved with a primitive only, so resolving it does no lookup the guest
  // can poison (the thenable check runs only for objects). The child judges
  // the number in its own realm (ADR-0557 §6).
  return new Promise<number>((resolve) => {
    const finish = (caught: unknown): void => resolve(settle(caught));
    try {
      setUp();
      const entry = launch();
      // Guest code has run from here: no `await`, which looks up the guest's
      // `constructor`/`then` (`onSettled`).
      onSettled(
        entry,
        () =>
          onSettled(
            awaitDrain({ capMs: Number.POSITIVE_INFINITY }),
            () => {
              try {
                // The runtime's own exit: a guest-replaced `process.exit` must
                // not change this run's status (Node's natural exit does not
                // call it either).
                nativeExit();
                throw new Error('isolate-host guest: process.exit() returned');
              } catch (caught) {
                finish(caught);
              }
            },
            finish,
          ),
        finish,
      );
    } catch (caught) {
      finish(caught);
    }
  });
}

function run(source: string): Promise<number> {
  return runToExit(() => {
    // `node -e` only: a file's realm has no builtin-module globals.
    installEvalBuiltinGlobals();
    return runNodeEntry({
      kind: 'eval',
      vfs: syncMirror(),
      cwd: CWD,
      source,
      print: false,
      explicitCommonJs: false,
    });
  });
}

/**
 * `node <path> [args]` (ADR-0568): rifty's program entry over this realm's
 * FS. An ES module entry is a declared gap: rifty's ESM loader needs `URL`,
 * a ceiling global here.
 */
function runFile(path: string, args: readonly string[]): Promise<number> {
  return runToExit(() => {
    const entryPath = resolvePosix(CWD, path);
    riftyProcess.argv = [riftyProcess.execPath, entryPath, ...args];
    if (isEsmEntry(entryPath)) throw esmGap();
    return runNodeEntry({ vfs: syncMirror(), entryPath, cwd: CWD });
  });
}

const esmGap = (): NotImplementedError =>
  new NotImplementedError(
    'isolate-host.esm',
    'ES modules need URL, absent in the rifty isolate host; use CommonJS require(), ADR-0568',
  );

/** The entry resolves as an ES module (`.mjs`, `"type": "module"`). A miss is the loader's own error. */
function isEsmEntry(entryPath: string): boolean {
  try {
    const loader = createModuleLoader(syncMirror(), { cwd: CWD });
    return loader.resolver.resolve(entryPath, { fromFile: entryPath, esm: true }).kind === 'esm';
  } catch {
    return false;
  }
}

/** POSIX `path.resolve(base, p)` for an absolute `base`. */
function resolvePosix(base: string, p: string): string {
  const parts: string[] = [];
  for (const seg of `${p.startsWith('/') ? '' : base}/${p}`.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return `/${parts.join('/')}`;
}

/** Installs the runtime for one run; before any guest code. */
function setUp(): void {
  installProcessGlobals();
  installTimerGlobals();
  (globalThis as { Buffer?: unknown }).Buffer = Buffer;
  setDefaultProcessOutputSink((fd, bytes) => bridge.write(fd, bytes));
  // Node's global console is `require('console')`: util.format over process.stdout/stderr.
  (globalThis as { console?: unknown }).console = nodeConsole;
  setUncaughtHandler((error) => {
    if (!handleRealmUncaughtError(error)) fatal(error);
  });
  for (const name of EGRESS_MODULES) {
    registerBuiltin(name, () => {
      throw new NotImplementedError(
        `isolate-host.${name}`,
        'no network in the rifty isolate host, ADR-0557',
      );
    });
  }
  for (const [name, hint] of Object.entries(HOST_CEILING_MODULES)) {
    registerBuiltin(name, () => {
      throw new NotImplementedError(`isolate-host.${name}`, `${hint}, ADR-0557`);
    });
  }
  installCeilingGlobals();
  setProcessCwd(CWD);
  nativeExit = riftyProcess.exit.bind(riftyProcess) as () => void;
}

/** A rejection isolated-vm found unhandled after the microtask checkpoint (a copy of the reason). */
function rejection(copied: unknown): void {
  // A reason isolated-vm could not copy out (function-bearing object, symbol): Node
  // still fails the run; the reason itself is lost (compat ⚠️).
  const reason =
    copied === UNCOPYABLE_REJECTION
      ? new Error(
          'isolate-host: an unhandled rejection reason that cannot be copied out of the isolate',
        )
      : copied;
  if (!handleRealmUnhandledRejection(reason, undefined)) fatal(reason);
}

/** The realm's whole FS; whenever no guest code runs. After guest code ran, the result is guest-authored. */
function snapshot(options: SnapshotOptions): Uint8Array {
  refuseIfBroken();
  return snapshotFs(guestFs, options);
}

/** Replace the realm's FS; only in a fresh isolate (module cache, fds and cwd would keep the old tree). */
function restore(bytes: Uint8Array, options: SnapshotOptions): void {
  refuseIfBroken();
  if (started)
    throw new FsSnapshotError('ERR_FS_SNAPSHOT_NOT_FRESH', 'restore runs only before guest code');
  try {
    restoreFs(guestFs, bytes, options);
  } catch (error) {
    const refusedFirst =
      error instanceof TypeError ||
      (error instanceof FsSnapshotError && BEFORE_WRITING.has(error.code));
    if (!refusedFirst) broken = true;
    throw error;
  }
}

Object.defineProperty(globalThis, '__riftyGuest', {
  value: Object.freeze({ run, runFile, fire: fireTimer, rejection, snapshot, restore }),
  configurable: true,
});
