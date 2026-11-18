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
import { syncMirror } from '@riftydev/vfs';
import { installMemoryFs } from '@riftydev/vfs/internal';
import { bindNotImplemented } from './loud.ts';
// Evaluated before every runtime module: the build injects it first (scripts/build-runtime.mjs).
import { bridge, fireTimer, installCeilingGlobals, setUncaughtHandler } from './web-shim.ts';

bindNotImplemented(NotImplementedError);

const CWD = '/workspace';
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

function exitCodeOf(reason: unknown): number | null {
  if (typeof reason !== 'object' || reason === null) return null;
  const r = reason as { code?: unknown; exitCode?: unknown };
  return r.code === 'RIFTY_PROCESS_EXIT' && typeof r.exitCode === 'number' ? r.exitCode : null;
}

function writeFatal(error: unknown): void {
  const text =
    error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);
  riftyProcess.stderr.write(`${text}\n`);
}

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
    installCeilingGlobals();
    setProcessCwd(CWD);
    await runNodeEntry({
      kind: 'eval',
      vfs: syncMirror(),
      cwd: CWD,
      source,
      print: false,
      explicitCommonJs: false,
    });
    await awaitDrain({ capMs: Number.POSITIVE_INFINITY });
    riftyProcess.exit();
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
function rejection(reason: unknown): void {
  if (!handleRealmUnhandledRejection(reason, undefined)) fatal(reason);
}

Object.defineProperty(globalThis, '__riftyGuest', {
  value: Object.freeze({ run, fire: fireTimer, rejection }),
  configurable: true,
});
