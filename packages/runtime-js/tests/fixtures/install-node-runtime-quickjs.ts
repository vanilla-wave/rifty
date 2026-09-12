import { type KernelProcessSpec, publishKernelProcessSpec } from '../../../kernel/src/index.ts';
import { Buffer as RiftyBuffer } from '../../src/builtins/buffer.ts';
import { NodeProcess } from '../../src/builtins/process.ts';
import { isVmEngineReady } from '../../src/builtins/vm/quickjs-loader.ts';
import { installNodeRuntime } from '../../src/ipc/install-process.ts';

const hostProcess = process;
const hostStdout = hostProcess.stdout.write.bind(hostProcess.stdout);
const hostStderr = hostProcess.stderr.write.bind(hostProcess.stderr);
const hostSetTimeout = globalThis.setTimeout.bind(globalThis);
const hostClearTimeout = globalThis.clearTimeout.bind(globalThis);
const nativeThen = Promise.prototype.then;
const stdin = new MessageChannel();
const ipc = new MessageChannel();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function closeChannels(): void {
  stdin.port1.close();
  stdin.port2.close();
  ipc.port1.close();
  ipc.port2.close();
}

async function main(): Promise<void> {
  const spec: KernelProcessSpec = {
    pid: 7,
    ppid: 3,
    argv: ['rifty', '/srv.js'],
    env: {},
    cwd: '/workspace/app',
    stdio: {
      stdout: { write() {} },
      stderr: { write() {} },
      stdin: stdin.port1,
      ipc: ipc.port1,
    },
  };
  publishKernelProcessSpec(spec);
  assert(!isVmEngineReady(), 'QuickJS engine was ready before cold preload');

  const readiness = installNodeRuntime(spec);
  assert(globalThis.process instanceof NodeProcess, 'NodeProcess was not installed synchronously');
  assert(
    (globalThis as { Buffer?: unknown }).Buffer === RiftyBuffer,
    'Rifty Buffer was not installed synchronously',
  );
  assert(Promise.prototype.then !== nativeThen, 'Promise.then was not patched synchronously');
  assert(readiness instanceof Promise, 'QuickJS install returned no readiness Promise');
  assert(!isVmEngineReady(), 'QuickJS readiness settled synchronously');
  await readiness;
  assert(isVmEngineReady(), 'QuickJS engine was not ready after awaited preload');
}

const timeout = hostSetTimeout(() => {
  hostStderr('installNodeRuntime QuickJS fixture timed out after 30000ms\n');
  hostProcess.exitCode = 2;
  closeChannels();
}, 30_000);
timeout.unref?.();

main().then(
  () => {
    hostClearTimeout(timeout);
    closeChannels();
    hostSetTimeout(() => {
      const activeHandles = (
        hostProcess as typeof process & { _getActiveHandles(): unknown[] }
      )._getActiveHandles();
      assert(
        ![stdin.port1, stdin.port2, ipc.port1, ipc.port2].some((port) =>
          activeHandles.includes(port),
        ),
        'QuickJS fixture published success before MessagePort teardown',
      );
      hostStdout('RIFTY_INSTALL_NODE_RUNTIME_QUICKJS_OK\n');
    }, 0);
  },
  (error: unknown) => {
    hostClearTimeout(timeout);
    closeChannels();
    hostStderr(`${error instanceof Error ? error.stack : String(error)}\n`);
    hostProcess.exitCode = 1;
  },
);
