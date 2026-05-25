/// <reference lib="webworker" />
/**
 * Worker-side entry point for the JS runtime.
 *
 * On boot it posts `{ type: 'ready' }`. From then on it accepts:
 *   - `eval` requests (code -> stdout/stderr/result events)
 *   - `load-fixture` (preload files into the worker-local in-memory VFS)
 *   - `ping` (responds with `pong`)
 *
 * On boot it also installs Node-compatible globals (`process`, `Buffer`,
 * `setImmediate`/`clearImmediate`) so user code that expects them just works.
 */

import { Buffer } from './builtins/buffer.ts';
import { __setCreateRequireImpl } from './builtins/module.ts';
import { installProcessGlobals, setProcessCwd } from './builtins/process.ts';
import { installTimerGlobals } from './builtins/timers.ts';
import { createModuleLoader } from './module-loader/index.ts';
import { MemorySyncVfs } from './module-loader/memory-sync-vfs.ts';
import type { EvalRequest, EvalResult, HostMessage, WorkerMessage } from './protocol.ts';
import { installConsole } from './repl/console.ts';
import { evalInRepl } from './repl/eval.ts';
import { inspect } from './repl/inspect.ts';

declare const self: DedicatedWorkerGlobalScope;

installProcessGlobals();
installTimerGlobals();
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

const vfs = new MemorySyncVfs();
let loader = createModuleLoader(vfs, { cwd: '/' });

function rebindReplBindings(): void {
  (self as unknown as { require: (s: string) => unknown }).require = (specifier: string) =>
    loader.require(specifier, '/__repl__.js');
  (self as unknown as { __riftyImport: (s: string) => Promise<unknown> }).__riftyImport = (
    specifier: string,
  ) => loader.import(specifier, '/__repl__.js');
  // Hook node:module's createRequire to the live loader.
  __setCreateRequireImpl((from: string) => {
    const req = (id: string) => loader.require(id, from);
    return req as ((id: string) => unknown) & {
      resolve?: (id: string) => string;
      cache?: Record<string, unknown>;
    };
  });
}
rebindReplBindings();

function post(msg: WorkerMessage): void {
  self.postMessage(msg);
}

const sink = {
  stdout(chunk: string) {
    post({ type: 'stdout', chunk });
  },
  stderr(chunk: string) {
    post({ type: 'stderr', chunk });
  },
};
installConsole(sink);

async function handleEval(req: EvalRequest): Promise<EvalResult> {
  // ADR-0019 — when the host attaches `cwd` to the eval request (e.g. the
  // kernel propagating a `ProcessRecord.cwd` snapshot at spawn time), seed
  // the per-Worker cwd cell before running user code. `setProcessCwd`
  // bypasses VFS validation: the host is trusted to pass a path that's
  // already been resolved against the active record.
  if (req.cwd !== undefined) {
    setProcessCwd(req.cwd);
  }
  try {
    const value = await evalInRepl(req.code);
    if (value !== undefined) {
      post({ type: 'stdout', chunk: `${inspect(value)}\n` });
    }
    return { id: req.id, ok: true, value: undefined };
  } catch (err) {
    if (err instanceof Error) {
      post({ type: 'stderr', chunk: `${err.stack ?? `${err.name}: ${err.message}`}\n` });
      const result: EvalResult = {
        id: req.id,
        ok: false,
        error: { name: err.name, message: err.message, stack: err.stack ?? '' },
      };
      return result;
    }
    const message = String(err);
    post({ type: 'stderr', chunk: `${message}\n` });
    return { id: req.id, ok: false, error: { name: 'Error', message } };
  }
}

self.addEventListener('message', async (event: MessageEvent<HostMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'ping':
      post({ type: 'pong' });
      break;
    case 'load-fixture':
      vfs.loadFixture(msg.files);
      loader = createModuleLoader(vfs, { cwd: '/' });
      rebindReplBindings();
      break;
    case 'eval': {
      const result = await handleEval(msg.request);
      post({ type: 'result', result });
      break;
    }
  }
});

post({ type: 'ready' });
