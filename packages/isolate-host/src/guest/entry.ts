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

function exitCodeOf(reason: unknown): number | null {
  if (typeof reason !== 'object' || reason === null) return null;
  const r = reason as { code?: unknown; exitCode?: unknown };
  return r.code === 'RIFTY_PROCESS_EXIT' && typeof r.exitCode === 'number' ? r.exitCode : null;
}

function writeFatal(error: unknown): void {
  const text =
    error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);
  // Straight to the host, as Node's fatal path bypasses a replaced
  // `process.stderr.write`: guest code must not forge or mute a failure.
  writeHost(2, `${text}\n`);
}

/** The runtime's own `process.exit`, captured before guest code can replace it. */
let nativeExit: () => void = () => {
  throw new Error('isolate-host guest: exit before the runtime was installed');
};

let finished = false;
function finish(code: number): void {
  if (finished) return;
  finished = true;
  bridge.done(code);
}

/** An uncaught error the runtime did not claim (no eval lifecycle): Node's fatal exit. */
function fatal(error: unknown): void {
  writeFatal(error);
  finish(1);
}

async function run(source: string): Promise<void> {
  let code: number;
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
    const error =
      caught instanceof SyntaxError && ESM_SYNTAX.some((m) => caught.message.includes(m))
        ? new NotImplementedError(
            'isolate-host.node-eval-esm',
            'Node runs -e input with ESM syntax as a module; this host evaluates CommonJS only — use require()',
          )
        : caught;
    const exited = exitCodeOf(error);
    if (exited === null) writeFatal(error);
    code = exited ?? 1;
  }
  finish(code);
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
