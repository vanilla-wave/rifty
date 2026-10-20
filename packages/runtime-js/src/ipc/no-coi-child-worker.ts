import {
  type KernelProcessSpec,
  globalProcessManager,
  publishKernelEntryBootstrap,
  publishKernelProcessSpec,
  publishKernelSyncApi,
} from '@riftydev/kernel';
import { installFetchKeepalive } from '../builtins/fetch-keepalive.ts';
import { installHostAsyncKeepalive } from '../builtins/host-async-keepalive.ts';
import { refreshRuntimeJsProcessBuiltin } from '../builtins/index.ts';
import { buildNodeEntryWorkerEntry } from '../builtins/node-entry-runtime-config.ts';
import { runNodeEntry } from '../builtins/node-entry.ts';
import { setActiveNodeProcessBootstrap } from '../builtins/process-bootstrap-identity.ts';
import { type NodeProcess, bindNodeProcessDescendantAuthority } from '../builtins/process.ts';
import { installTimerGlobals } from '../builtins/timers.ts';
import { setVmEngineOverride } from '../builtins/vm/engine-config.ts';
import { awaitDrain, installEventLoopKeepalive } from '../internal/event-loop-keepalive.ts';
import { installConsole } from '../repl/console.ts';
import { installNodeRuntime } from './install-process.ts';
import {
  type NoCoiChildTransport,
  createNoCoiChildSyncApi,
  setNoCoiChildTransport,
} from './no-coi-child-transport.ts';
import { installRemoteSyncFs } from './sync-rpc-fs.ts';

export interface NoCoiChildInit {
  readonly type: 'no-coi-child-init';
  readonly transport: NoCoiChildTransport;
  readonly pid: number;
  readonly ppid: number;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly ipc: 'none' | 'json' | 'advanced';
  readonly execArgv: readonly string[];
  readonly vmEngine: 'quickjs' | 'rewrite';
}

export function installNoCoiChildWorker(): void {
  const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
  const listener = (event: MessageEvent<NoCoiChildInit>): void => {
    if (event.data?.type !== 'no-coi-child-init') return;
    scope.removeEventListener('message', listener as EventListener);
    const control = event.ports[0];
    const stdin = event.ports[1];
    if (!control || !stdin) throw new Error('no-COI child requires control and stdin ports');
    const init = event.data;
    const write = (stream: 'stdout' | 'stderr', bytes: Uint8Array): void =>
      control.postMessage({ kind: stream, bytes });
    void (async () => {
      setNoCoiChildTransport(init.transport);
      Object.defineProperty(globalThis, Symbol.for('rifty.runtime-js.sandbox-toolchain.v1'), {
        value: true,
      });
      setVmEngineOverride(init.vmEngine);
      const api = createNoCoiChildSyncApi(init.transport.endpoint);
      publishKernelSyncApi(api);
      const vfs = installRemoteSyncFs(api.call, api.callBinary);
      const entry = buildNodeEntryWorkerEntry(
        init.transport.workerUrl,
        { RIFTY_CHILD_TRANSPORT: 'service-worker' },
        {
          kind: 'program',
          bin: false,
          remoteFs: true,
          nodeServe: false,
          ipc: init.ipc,
          execArgv: init.execArgv,
        },
      );
      publishKernelEntryBootstrap(entry.bootstrap ?? null);
      const spec: KernelProcessSpec = {
        pid: init.pid,
        ppid: init.ppid,
        argv: init.argv,
        env: init.env,
        cwd: init.cwd,
        stdio: {
          stdout: { write: (bytes) => write('stdout', bytes) },
          stderr: { write: (bytes) => write('stderr', bytes) },
          stdin,
          ipc: control,
        },
      };
      publishKernelProcessSpec(spec);
      await installNodeRuntime(spec);
      const proc = (globalThis as unknown as { process: NodeProcess }).process;
      setActiveNodeProcessBootstrap(proc, true);
      bindNodeProcessDescendantAuthority(proc, globalProcessManager);
      refreshRuntimeJsProcessBuiltin();
      installTimerGlobals();
      installEventLoopKeepalive();
      installFetchKeepalive();
      installHostAsyncKeepalive();
      installConsole({
        stdout: (text) => proc.stdout.write(text),
        stderr: (text) => proc.stderr.write(text),
      });
      const exit = proc.exit;
      const entryPath = init.argv[1];
      if (entryPath === undefined) throw new Error('child entry is missing');
      await runNodeEntry({ vfs, entryPath, cwd: init.cwd });
      await awaitDrain({ capMs: 600_000 });
      exit();
    })().catch((error: unknown) => {
      const exit = error as { code?: unknown; exitCode?: unknown };
      if (exit?.code === 'RIFTY_PROCESS_EXIT' && typeof exit.exitCode === 'number') {
        control.postMessage({ kind: 'control:self-exit', code: exit.exitCode });
      } else {
        write(
          'stderr',
          new TextEncoder().encode(
            `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
          ),
        );
        control.postMessage({ kind: 'control:self-exit', code: 1 });
      }
    });
  };
  scope.addEventListener('message', listener as EventListener);
  // A host wrapper may load this module dynamically after Worker message dispatch starts.
  scope.postMessage({ type: 'no-coi-child-ready' });
}
