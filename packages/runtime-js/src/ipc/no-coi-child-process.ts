import { EventEmitter, Readable, Writable } from '@riftydev/io';
import { type ProcessHandle, globalProcessManager } from '@riftydev/kernel';
import {
  type SpawnWorkerChildOptions,
  activeChildProcessContext,
  snapshotChildEnvironment,
} from '../builtins/child_process-worker.ts';
import { nodeChildSpawnOptions } from '../builtins/node-entry-runtime-config.ts';
import { resolveVmEngineName } from '../builtins/vm/engine-config.ts';
import { buildChildExecutionPlan } from '../internal/node-entry-path.ts';
import { NO_COI_CHILD_NAME, openNoCoiChildRoute } from './no-coi-child-transport.ts';
import type { NoCoiChildInit } from './no-coi-child-worker.ts';

export function spawnNoCoiChild(
  args: readonly string[],
  options: SpawnWorkerChildOptions,
): {
  handle: ProcessHandle;
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  inbound: EventEmitter;
} {
  const parent = activeChildProcessContext();
  const plan = buildChildExecutionPlan(parent.cwd, options.cwd, args[0]);
  if (plan.entryPath === undefined) throw new Error('child entry path is missing');
  const entryPath = plan.entryPath;
  const argv = ['node', entryPath, ...args.slice(1)];
  const env = snapshotChildEnvironment(options.env, parent.env);
  const vmEngine = resolveVmEngineName();
  const route = openNoCoiChildRoute(parent.federated);
  const transport = route.transport;
  const control = new MessageChannel();
  const input = new MessageChannel();
  const inbound = new EventEmitter();
  const closePorts = (): void => {
    inbound.removeAllListeners();
    control.port1.close();
    control.port2.close();
    input.port1.close();
    input.port2.close();
    route.close();
  };
  // The port buffers startup messages; the returned child must already be able to send.
  inbound.on('send', (payload) => control.port1.postMessage({ kind: 'ipc:message', payload }));
  inbound.on('disconnect-request', () => control.port1.postMessage({ kind: 'ipc:disconnect' }));
  inbound.on('signal', (signal) => control.port1.postMessage({ kind: 'control:signal', signal }));
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      try {
        input.port1.postMessage(chunk);
        callback();
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
    final(callback) {
      input.port1.postMessage({ kind: 'stdin:eof' });
      callback();
    },
  });
  const handle: ProcessHandle = (() => {
    try {
      return globalProcessManager.spawn(
        'node',
        async (io) => {
          if (io.signal.aborted) {
            closePorts();
            return;
          }
          let worker: Worker;
          try {
            worker = new Worker(transport.workerUrl, { type: 'module', name: NO_COI_CHILD_NAME });
          } catch (error) {
            closePorts();
            throw error;
          }
          await new Promise<void>((resolve) => {
            let settled = false;
            const cleanup = (): void => {
              if (settled) return;
              settled = true;
              worker.terminate();
              closePorts();
              io.signal.removeEventListener('abort', cleanup);
              resolve();
            };
            const finish = (code: number): void => {
              if (settled) return;
              try {
                io.complete(code);
              } finally {
                cleanup();
              }
            };
            io.signal.addEventListener('abort', cleanup, { once: true });
            if (io.signal.aborted) {
              cleanup();
              return;
            }
            worker.addEventListener('error', (event) => {
              event.preventDefault();
              if (settled) return;
              stderr.push(
                `${event.message || 'no-COI child Worker failed during startup or execution'}\n`,
              );
              finish(1);
            });
            control.port1.onmessage = (event: MessageEvent) => {
              if (settled) return;
              const frame = event.data;
              if (frame?.kind === 'stdout' || frame?.kind === 'stderr') {
                (frame.kind === 'stdout' ? stdout : stderr).push(frame.bytes);
              } else if (frame?.kind === 'control:self-exit') {
                finish(frame.code);
              } else if (frame?.kind === 'control:self-signal') {
                handle.kill(frame.signal);
              } else if (frame?.kind === 'ipc:message') {
                handle.emit('message', frame.payload);
              } else if (frame?.kind === 'ipc:disconnect') {
                handle.emit('disconnect');
              }
            };
            const initialize = (event: MessageEvent): void => {
              if (event.data?.type !== 'no-coi-child-ready' || settled) return;
              worker.removeEventListener('message', initialize);
              worker.postMessage(
                {
                  type: 'no-coi-child-init',
                  transport,
                  pid: handle.pid,
                  ppid: parent.pid,
                  argv,
                  cwd: plan.cwd,
                  env,
                  ipc: options.ipc,
                  execArgv: options.execArgv ?? [],
                  vmEngine,
                } satisfies NoCoiChildInit,
                [control.port2, input.port2],
              );
            };
            worker.addEventListener('message', initialize);
          });
        },
        parent.pid,
        {
          ...nodeChildSpawnOptions(plan.cwd, parent.federated),
          remoteControl: {
            context: route.context,
            kill(pid, signal) {
              control.port1.postMessage({ kind: 'control:kill-tree', pid, signal });
              return true;
            },
          },
        },
      );
    } catch (error) {
      closePorts();
      throw error;
    }
  })();
  route.context.callerPid = handle.pid;
  handle.on('stderr', (chunk) => stderr.push(chunk));
  return { handle, stdin, stdout, stderr, inbound };
}
