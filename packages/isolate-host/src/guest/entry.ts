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
  handleRealmUncaughtError,
  handleRealmUnhandledRejection,
  readNodeProcessTerminal,
  setDefaultProcessOutputSink,
} from '@riftydev/runtime-js/internal';
import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { syncMirror } from '@riftydev/vfs';
import { installMemoryFs } from '@riftydev/vfs/internal';
import { bindNotImplemented } from './loud.ts';
// Evaluated before every runtime module: the build injects it first (scripts/build-runtime.mjs).
import {
  bridge,
  fireTimer,
  installCeilingGlobals,
  setUncaughtHandler,
  writeHost,
} from './web-shim.ts';

bindNotImplemented(NotImplementedError);

// Captured before guest code: the post-guest tail uses no replaceable member.
const stringIncludesPrimordial = String.prototype.includes;
const reflectApplyPrimordial = Reflect.apply;
const stringIncludes = (haystack: string, needle: string): boolean =>
  reflectApplyPrimordial(stringIncludesPrimordial, haystack, [needle]) as boolean;

const CWD = '/workspace';
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
const ESM_SYNTAX = [
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
 * The run's status, as this realm's runtime reports it (ADR-0557 §5).
 *
 * This realm is the guest's: every lookup here can be poisoned, so nothing it
 * returns is authority. The child validates the number in its own realm and
 * treats anything else — a throw, a hang in a render, a garbage value — as a
 * failed run with its own diagnostic. What a guest can reach is therefore its
 * own status and its own text, never the consumer's view of the host.
 */
function settle(caught: unknown): { code: number; diagnosed: boolean } {
  // The runtime's own terminal for this process; its `exitCode` is already
  // clamped by the runtime (`toUint8ExitCode`). A lookalike the guest threw is
  // not it, so a thrown `{code:'RIFTY_PROCESS_EXIT'}` cannot pick a status.
  try {
    const terminal = readNodeProcessTerminal(riftyProcess);
    if (terminal !== null) {
      const code = terminal.exitCode;
      if (typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 255) {
        return { code, diagnosed: false };
      }
    }
  } catch {
    // A broken lifecycle read is a failed run, not an exit.
  }
  writeDiagnostic(esmGapOf(caught) ?? caught);
  // `diagnosed`: this path owed stderr a line. Object-literal syntax, no lookup
  // the guest can poison — the child checks the line actually arrived.
  return { code: 1, diagnosed: true };
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
    if (!ESM_SYNTAX.some((m) => stringIncludes(message, m))) return null;
    return new NotImplementedError(
      'isolate-host.node-eval-esm',
      'Node runs -e input with ESM syntax as a module; this host evaluates CommonJS only — use require()',
    );
  } catch {
    return null;
  }
}

/** Write the guest's error as Node's fatal path does; never throws. */
function writeDiagnostic(error: unknown): void {
  for (const render of [
    () => (error as Error).stack,
    () => {
      const { name, message } = error as Error;
      return typeof name === 'string' && typeof message === 'string'
        ? `${name}: ${message}`
        : undefined;
    },
    () => (error as Error).message,
    // A non-Error throw: its type, never a coercion the guest controls.
    () => `isolate-host: the run threw a non-Error value (${typeof error})`,
  ]) {
    try {
      const text = render();
      if (typeof text === 'string' && text.length > 0) {
        writeHost(2, `${text}\n`);
        return;
      }
    } catch {
      // This rendering is poisoned; try the next one.
    }
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

async function run(source: string): Promise<{ code: number; diagnosed: boolean }> {
  let outcome: { code: number; diagnosed: boolean } = { code: 0, diagnosed: false };
  try {
    installMemoryFs();
    syncMirror().mkdirSync(CWD, { recursive: true });
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
    installEvalBuiltinGlobals();
    setProcessCwd(CWD);
    nativeExit = riftyProcess.exit.bind(riftyProcess) as () => void;
    await runNodeEntry({
      kind: 'eval',
      vfs: syncMirror(),
      cwd: CWD,
      source,
      print: false,
      explicitCommonJs: false,
    });
    await awaitDrain({ capMs: Number.POSITIVE_INFINITY });
    // The runtime's own exit: a guest-replaced `process.exit` must not change
    // this run's status (Node's natural exit does not call it either).
    nativeExit();
    throw new Error('isolate-host guest: process.exit() returned');
  } catch (caught) {
    outcome = settle(caught);
  }
  // Crosses as copied data; the child validates it (ADR-0557 §5).
  return outcome;
}

/** A rejection isolated-vm found unhandled after the microtask checkpoint (a copy of the reason). */
function rejection(copied: unknown): void {
  // A reason isolated-vm could not copy out (function-bearing object, symbol): Node
  // still fails the run; the reason itself is lost (compat ⚠️).
  const reason =
    copied === bridge.uncopyableReason
      ? new Error(
          'isolate-host: an unhandled rejection reason that cannot be copied out of the isolate',
        )
      : copied;
  if (!handleRealmUnhandledRejection(reason, undefined)) fatal(reason);
}

Object.defineProperty(globalThis, '__riftyGuest', {
  value: Object.freeze({ run, fire: fireTimer, rejection }),
  configurable: true,
});
