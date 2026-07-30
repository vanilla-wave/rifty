import { BroadcastChannel, Worker } from 'node:worker_threads';
import { describe, expect, it, vi } from 'vitest';
import {
  KERNEL_SYNC_CALL_KEY,
  getKernelWorkerUrl,
  setKernelWorkerUrl,
} from '../../../packages/kernel/src/index.ts';
import { clearKernelWorkerUrl } from '../../../packages/kernel/src/spawn-worker.ts';
import { refreshRuntimeJsProcessBuiltin } from '../../../packages/runtime-js/src/builtins/index.ts';
import {
  getProcessCwd,
  riftyProcess,
  setProcessCwd,
} from '../../../packages/runtime-js/src/builtins/process.ts';
import { asyncVfs, syncMirror } from '../../../packages/vfs/src/index.ts';
import { setSyncMirror } from '../../../packages/vfs/src/internal/index.ts';
import workerEnvCase from '../cases/worker_threads/env-semantics.case.ts';
import {
  NODE_CLI_EVAL_TRANSIENT_SOURCE_PATH,
  type NodeCliEvalVfsActor,
  nodeCliEvalTransientSourceCarrierMutations,
  nodeCliEvalVfsFileContent,
} from './node-cli-eval-vfs-observer.ts';
import {
  type NodeCliEvalBootstrapFault,
  type NodeCliEvalVfsFault,
  runInRifty,
} from './run-in-rifty.ts';

// Leave room for runInRifty's 30s diagnostic deadline under loaded CI Workers.
const REAL_WORKER_TEST_TIMEOUT_MS = 35_000;

function restoreGlobalDescriptor(name: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}

function restoreKernelWorkerUrl(url: string | URL | null): void {
  if (url === null) clearKernelWorkerUrl();
  else setKernelWorkerUrl(url);
}

describe('runInRifty', () => {
  it(
    'accepts the atomic node-entry v2 bootstrap in physical Worker mode',
    async () => {
      await expect(runInRifty(workerEnvCase)).resolves.toBe(workerEnvCase.expected);
    },
    REAL_WORKER_TEST_TIMEOUT_MS,
  );

  it(
    'keeps the eval-only sync API out of a program physical Worker',
    async () => {
      const stdout = await runInRifty({
        kind: 'child-worker',
        expectedPhysicalWorkers: 1,
        cwd: '/project',
        setup: {
          files: {
            'project/sync-api-probe.cjs':
              "process.stdout.write('sync-api:' + Object.hasOwn(globalThis, '__riftyKernelSyncCall') + '\\n');\n",
          },
        },
        code: `
          const { spawn } = require('node:child_process');
          const child = spawn('node', ['sync-api-probe.cjs'], {
            cwd: require('node:process').cwd(),
          });
          let stdout = '';
          child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
          child.once('close', () => console.log(stdout.trim()));
        `,
      });

      expect(stdout).toBe('sync-api:false\n');
    },
    REAL_WORKER_TEST_TIMEOUT_MS,
  );

  it('rejects every eval-only probe outside an eval physical child', async () => {
    await expect(
      runInRifty(workerEnvCase, {
        nodeCliEvalVfsProbe: {
          expectedGuestMutations: [],
          fault: 'sab-remote-transient-source-file',
        },
      }),
    ).rejects.toThrow('RunInRiftyOptions.nodeCliEvalVfsProbe requires kind node-cli-eval');
    await expect(runInRifty(workerEnvCase, { nodeCliEvalPreviewProbe: {} })).rejects.toThrow(
      'RunInRiftyOptions.nodeCliEvalPreviewProbe requires kind node-cli-eval',
    );
    await expect(
      runInRifty(workerEnvCase, { nodeCliEvalBootstrapFault: 'wrong-protocol' }),
    ).rejects.toThrow('RunInRiftyOptions.nodeCliEvalBootstrapFault requires kind node-cli-eval');
  });

  it('rejects a global VFS carrier phase spanning multiple eval children', async () => {
    const invocation = (label: string) => ({
      label,
      nodeArgv: ['-e', ''],
    });

    await expect(
      runInRifty(
        {
          kind: 'node-cli-eval',
          code: '',
          expectedPhysicalWorkers: 2,
          nodeCliEval: {
            sequential: [invocation('first'), invocation('second')],
            concurrent: [],
          },
        },
        {
          nodeCliEvalVfsProbe: {
            expectedGuestMutations: [],
            fault: 'sab-remote-transient-source-file',
          },
        },
      ),
    ).rejects.toThrow(
      'RunInRiftyOptions.nodeCliEvalVfsProbe.fault requires exactly one node-cli-eval invocation',
    );
  });

  it(
    'does not let a physical transient carrier satisfy same-path declared guest effects',
    async () => {
      const carrierPath = NODE_CLI_EVAL_TRANSIENT_SOURCE_PATH;
      const source = "'carrier-source';";
      const missingGuestWrite = {
        kind: 'write' as const,
        provenance: 'guest' as const,
        actor: 'workbench-owner' as const,
        path: carrierPath,
        content: nodeCliEvalVfsFileContent(carrierPath, source),
      };
      const unexpectedCarrierWrite = {
        kind: 'write' as const,
        provenance: 'carrier' as const,
        actor: 'sab-remote' as const,
        path: carrierPath,
        content: nodeCliEvalVfsFileContent(carrierPath, source),
      };
      const missingGuestRm = {
        kind: 'rm' as const,
        provenance: 'guest' as const,
        actor: 'workbench-owner' as const,
        path: carrierPath,
        recursive: false,
        force: true,
      };
      const unexpectedCarrierRm = {
        kind: 'rm' as const,
        provenance: 'carrier' as const,
        actor: 'sab-remote' as const,
        path: carrierPath,
        recursive: false,
        force: true,
      };

      await expect(
        runInRifty(
          {
            kind: 'node-cli-eval',
            code: '',
            expectedPhysicalWorkers: 1,
            nodeCliEval: {
              sequential: [
                {
                  label: 'transient-vfs-carrier-fault',
                  nodeArgv: ['-e', source],
                },
              ],
              concurrent: [],
            },
          },
          {
            nodeCliEvalVfsProbe: {
              expectedGuestMutations: [missingGuestWrite, missingGuestRm],
              fault: 'sab-remote-transient-source-file',
            },
          },
        ),
      ).rejects.toThrow(
        `node-cli-eval VFS audit mismatch: ${JSON.stringify({
          missing: [missingGuestWrite, missingGuestRm],
          unexpected: [unexpectedCarrierWrite, unexpectedCarrierRm],
        })}`,
      );
    },
    REAL_WORKER_TEST_TIMEOUT_MS,
  );

  it.each<
    readonly [
      label: string,
      fault: NodeCliEvalVfsFault | undefined,
      actor: NodeCliEvalVfsActor | undefined,
    ]
  >([
    ['clean normal path', undefined, undefined],
    ['Workbench-owner pre-bootstrap', 'workbench-owner-transient-source-file', 'workbench-owner'],
    ['SAB-remote pre-bootstrap', 'sab-remote-transient-source-file', 'sab-remote'],
    ['child-local pre-bootstrap MemoryFs', 'child-local-transient-source-file', 'child-local'],
  ])(
    'audits identical eval source bytes across the %s VFS boundary',
    async (_label, fault, actor) => {
      const guestPath = '/eval-guest-authored.txt';
      const guestContent = 'owner-guest';
      const source = `require('node:fs').writeFileSync(${JSON.stringify(
        guestPath,
      )}, ${JSON.stringify(guestContent)});`;
      const expectedGuestWrite = {
        kind: 'write' as const,
        provenance: 'guest' as const,
        actor: 'workbench-owner' as const,
        path: guestPath,
        content: nodeCliEvalVfsFileContent(guestPath, guestContent),
      };
      const invocationLabel = `${actor ?? 'clean'}-vfs-boundary`;
      const run = runInRifty(
        {
          kind: 'node-cli-eval',
          code: '',
          expectedPhysicalWorkers: 1,
          nodeCliEval: {
            sequential: [
              {
                label: invocationLabel,
                nodeArgv: ['-e', source],
              },
            ],
            concurrent: [],
          },
        },
        {
          nodeCliEvalVfsProbe: {
            expectedGuestMutations: [expectedGuestWrite],
            ...(fault === undefined ? {} : { fault }),
          },
        },
      );

      if (actor === undefined) {
        expect(JSON.parse(await run)).toEqual([
          {
            label: invocationLabel,
            stdout: '',
            stderr: '',
            frames: [],
            code: 0,
            signal: null,
          },
        ]);
        return;
      }

      await expect(run).rejects.toThrow(
        `node-cli-eval VFS audit mismatch: ${JSON.stringify({
          missing: [],
          unexpected: nodeCliEvalTransientSourceCarrierMutations(actor, source),
        })}`,
      );
    },
    REAL_WORKER_TEST_TIMEOUT_MS,
  );

  it(
    'consumes each concurrent eval launch scope when reporting and serving its preview',
    async () => {
      const firstSource =
        "require('node:http').createServer((_request, response) => { response.statusCode = 201; response.end('first-eval-preview'); }).listen(43_151);";
      const secondSource =
        "require('node:http').createServer((_request, response) => { response.statusCode = 202; response.end('second-eval-preview'); }).listen(43_152);";
      const invocation = (label: string, source: string) => ({
        label,
        nodeArgv: ['-e', source],
      });

      const stdout = await runInRifty(
        {
          kind: 'node-cli-eval',
          code: '',
          expectedPhysicalWorkers: 2,
          nodeCliEval: {
            sequential: [],
            concurrent: [
              invocation('preview-first', firstSource),
              invocation('preview-second', secondSource),
            ],
          },
        },
        {
          nodeCliEvalPreviewProbe: {
            'preview-first': { port: 43_151, status: 201, body: 'first-eval-preview' },
            'preview-second': { port: 43_152, status: 202, body: 'second-eval-preview' },
          },
        },
      );

      expect(JSON.parse(stdout)).toMatchObject([
        { label: 'preview-first', signal: 'SIGTERM' },
        { label: 'preview-second', signal: 'SIGTERM' },
      ]);
    },
    REAL_WORKER_TEST_TIMEOUT_MS,
  );

  it.each<readonly [label: string, fault: NodeCliEvalBootstrapFault, expectedError: RegExp]>([
    ['wrong protocol', 'wrong-protocol', /protocol.*v3.*v2/iu],
    ['missing required field', 'missing-print', /missing field.*print/iu],
    ['wrong field type', 'print-not-boolean', /print.*boolean/iu],
    ['extra field', 'extra-launch-field', /unexpected field.*futureEvalField/iu],
    ['non-string execArgv entry', 'exec-argv-entry-not-string', /execArgv.*string/iu],
    ['program-only nodeServe', 'program-node-serve', /unexpected field.*nodeServe/iu],
    ['program-only ipc', 'program-ipc', /unexpected field.*ipc/iu],
  ])(
    'rejects physical corrupt eval bootstrap before source/VFS effects: %s',
    async (_label, fault, expectedError) => {
      const source = "require('node:fs').writeFileSync('/bootstrap-must-not-run.txt', 'ran');";
      const output = await runInRifty(
        {
          kind: 'node-cli-eval',
          code: '',
          expectedPhysicalWorkers: 1,
          nodeCliEval: {
            sequential: [
              {
                label: `corrupt-${fault}`,
                nodeArgv: ['-e', source],
              },
            ],
            concurrent: [],
          },
        },
        {
          nodeCliEvalBootstrapFault: fault,
          nodeCliEvalVfsProbe: { expectedGuestMutations: [] },
        },
      );
      const outcomes = JSON.parse(output) as readonly [
        {
          readonly stderr: string;
          readonly code: number | null;
          readonly signal: string | null;
        },
      ];

      expect(outcomes[0]).toMatchObject({ code: 1, signal: null });
      expect(outcomes[0].stderr).toMatch(expectedError);
    },
    REAL_WORKER_TEST_TIMEOUT_MS,
  );

  it('ends synthetic physical-parent stdin so an inherited child can settle', async () => {
    const stdout = await runInRifty({
      kind: 'child-worker',
      expectedPhysicalWorkers: 1,
      cwd: '/project',
      setup: {
        files: {
          'project/empty.js': '',
        },
      },
      code: `
        const { spawn } = require('node:child_process');
        const child = spawn('node', ['empty.js'], {
          cwd: require('node:process').cwd(),
          stdio: 'inherit',
        });
        child.once('close', () => console.log('closed'));
      `,
    });

    expect(stdout).toBe('closed\n');
  });

  it('waits for keepalive-backed timers before restoring console capture', async () => {
    const stdout = await runInRifty({
      code: `
        const { setTimeout } = require('node:timers/promises');
        (async () => {
          await setTimeout(35);
          console.log('after-drain');
        })();
      `,
    });

    expect(stdout).toBe('after-drain\n');
  });

  it('tracks global timers instead of truncating async output after a fixed grace', async () => {
    const stdout = await runInRifty({
      code: `
        (async () => {
          await new Promise((resolve) => setTimeout(resolve, 75));
          console.log('after-global-timer');
        })();
      `,
    });

    expect(stdout).toBe('after-global-timer\n');
  });

  it('exec-sync mode surfaces missing child scripts as ENOENT through the runtime handler', async () => {
    const stdout = await runInRifty({
      kind: 'exec-sync',
      code: `
        const { execSync } = require('node:child_process');
        try {
          execSync('node missing.js', { cwd: '/' });
        } catch (err) {
          console.log(err.code);
        }
      `,
    });

    expect(stdout).toBe('ENOENT\n');
  });

  it('feeds stdin concurrently with ESM top-level evaluation', async () => {
    const stdout = await runInRifty({
      kind: 'esm',
      stdin: [],
      code: `
        const order = [];
        let settle;
        const done = new Promise((resolve) => { settle = resolve; });
        const fallback = setTimeout(() => {
          order.push('fallback');
          settle();
        }, 75);
        process.stdin.once('end', () => {
          order.push('end');
          clearTimeout(fallback);
          settle();
        });
        process.stdin.resume();
        await done;
        console.log(order[0]);
      `,
    });

    expect(stdout).toBe('end\n');
  });

  it('keeps stdin transport bookkeeping out of the public end-listener count', async () => {
    const stdout = await runInRifty({
      stdin: [],
      code: `
        console.log(process.stdin.listenerCount('end'));
        process.stdin.resume();
      `,
    });

    expect(stdout).toBe('0\n');
  });

  it('acknowledges delivered stdin EOF after guest removeAllListeners', async () => {
    const stdout = await runInRifty(
      {
        stdin: [],
        code: `
          process.stdin.removeAllListeners('end');
          process.stdin.resume();
          console.log('alive');
        `,
      },
      { stdinTimeoutMs: 500 },
    );

    expect(stdout).toBe('alive\n');
  });

  it('captures raw stdout from a seeded process byte-exactly', async () => {
    const stdout = await runInRifty({
      stdin: [],
      code: `
        process.stdout.write('raw');
        process.stdin.resume();
      `,
    });

    expect(stdout).toBe('raw');
  });

  it('orders seeded raw and console stdout while excluding stderr', async () => {
    const stdout = await runInRifty({
      stdin: [],
      code: `
        process.stdout.write('raw-before|');
        console.log('console');
        process.stderr.write('hidden-raw-stderr');
        console.error('hidden-console-stderr');
        process.stdout.write(new Uint8Array([0xe2, 0x82]));
        process.stdout.write(new Uint8Array([0xac]));
        process.stdin.resume();
      `,
    });

    expect(stdout).toBe('raw-before|console\n€');
  });

  it('restores timer globals with their exact pre-case descriptors', async () => {
    const priorSetTimeout = Object.getOwnPropertyDescriptor(globalThis, 'setTimeout');
    if (!priorSetTimeout) throw new Error('test host has no global setTimeout descriptor');
    const guestEnumerable = !priorSetTimeout.enumerable;
    let observed: PropertyDescriptor | undefined;

    try {
      await runInRifty(
        {
          stdin: [],
          code: `
            Object.defineProperty(globalThis, 'setTimeout', {
              value: globalThis.setTimeout,
              writable: true,
              enumerable: ${guestEnumerable},
              configurable: true,
            });
            process.stdin.resume();
          `,
        },
        { createMessageChannel: () => new MessageChannel() },
      );
      observed = Object.getOwnPropertyDescriptor(globalThis, 'setTimeout');
    } finally {
      restoreGlobalDescriptor('setTimeout', priorSetTimeout);
    }

    expect(observed).toEqual(priorSetTimeout);
  });

  it('does not let a case-timeout ESM guest execute callbacks after rejection', async () => {
    const lateStateKey = '__RIFTY_PARITY_LATE_STATE__';
    const priorLateState = Object.getOwnPropertyDescriptor(globalThis, lateStateKey);
    const hostSetTimeout = globalThis.setTimeout.bind(globalThis);
    const hostLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await expect(
        runInRifty(
          {
            kind: 'esm',
            stdin: [],
            code: `
              await new Promise((resolve) => setTimeout(resolve, 40));
              globalThis.${lateStateKey} = 'leaked';
              console.log('late-after-timeout');
            `,
          },
          { caseTimeoutMs: 10 },
        ),
      ).rejects.toThrow('case timed out after 10ms');

      await new Promise<void>((resolve) => hostSetTimeout(resolve, 100));

      expect(Object.getOwnPropertyDescriptor(globalThis, lateStateKey)).toEqual(priorLateState);
      expect(hostLog).not.toHaveBeenCalledWith('late-after-timeout');
    } finally {
      hostLog.mockRestore();
      restoreGlobalDescriptor(lateStateKey, priorLateState);
    }
  });

  it('terminates a failed TTY realm before its late timer can mutate harness globals', async () => {
    const lateStateKey = '__RIFTY_PARITY_TTY_LATE_STATE__';
    const priorLateState = Object.getOwnPropertyDescriptor(globalThis, lateStateKey);
    const hostSetTimeout = globalThis.setTimeout.bind(globalThis);

    try {
      await expect(
        runInRifty({
          kind: 'tty-resize',
          code: `
            setTimeout(() => { globalThis.${lateStateKey} = 'leaked'; }, 40);
            throw new Error('tty-case-failed');
          `,
        }),
      ).rejects.toThrow('tty-case-failed');

      await new Promise<void>((resolve) => hostSetTimeout(resolve, 100));

      expect(Object.getOwnPropertyDescriptor(globalThis, lateStateKey)).toEqual(priorLateState);
    } finally {
      restoreGlobalDescriptor(lateStateKey, priorLateState);
    }
  });

  it('keeps parent settlement pending until the real Worker termination promise settles', async () => {
    const originalTerminate = Worker.prototype.terminate;
    let releaseTerminationBarrier: (() => void) | undefined;
    const terminationBarrier = new Promise<void>((resolve) => {
      releaseTerminationBarrier = resolve;
    });
    let reportRealTermination: (() => void) | undefined;
    const realTermination = new Promise<void>((resolve) => {
      reportRealTermination = resolve;
    });
    const terminateSpy = vi.spyOn(Worker.prototype, 'terminate').mockImplementation(function (
      this: Worker,
    ): Promise<number> {
      return originalTerminate.call(this).then(async (exitCode) => {
        reportRealTermination?.();
        await terminationBarrier;
        return exitCode;
      });
    });
    let run: Promise<string> | undefined;

    try {
      run = runInRifty({
        kind: 'tty-resize',
        code: `throw new Error('termination-order-probe');`,
      });
      let settled = false;
      void run.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      await realTermination;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(terminateSpy).toHaveBeenCalledTimes(1);
      expect(settled).toBe(false);

      releaseTerminationBarrier?.();
      await expect(run).rejects.toThrow('termination-order-probe');
    } finally {
      releaseTerminationBarrier?.();
      terminateSpy.mockRestore();
      await run?.catch(() => undefined);
    }
  });

  it('kills failed-Worker callbacks before they can publish a cross-realm side effect', async () => {
    const channelName = `rifty-parity-worker-termination-${Date.now()}-${Math.random()}`;
    const probe = new BroadcastChannel(channelName);
    const messages: unknown[] = [];
    const hostSetTimeout = globalThis.setTimeout.bind(globalThis);
    probe.onmessage = (event): void => {
      messages.push(event.data);
    };

    try {
      await expect(
        runInRifty({
          kind: 'tty-resize',
          code: `
            const probe = new BroadcastChannel(${JSON.stringify(channelName)});
            setTimeout(() => {
              probe.postMessage('late-worker-callback');
              probe.close();
            }, 500);
            throw new Error('cross-realm-probe');
          `,
        }),
      ).rejects.toThrow('cross-realm-probe');

      await new Promise<void>((resolve) => hostSetTimeout(resolve, 1_000));

      expect(messages).toEqual([]);
    } finally {
      probe.close();
    }
  });

  it('enforces the parent case timeout for a slow TTY case', async () => {
    await expect(
      runInRifty(
        {
          kind: 'tty-resize',
          code: `
            setTimeout(() => {
              console.log('late-tty-result');
            }, 118);
          `,
        },
        { caseTimeoutMs: 10 },
      ),
    ).rejects.toThrow('rifty parity case timed out after 10ms');
  });

  it('restores exec-sync and seeded process globals in exact LIFO order', async () => {
    const priorProcess = Object.getOwnPropertyDescriptor(globalThis, 'process');
    const priorCrossOrigin = Object.getOwnPropertyDescriptor(globalThis, 'crossOriginIsolated');
    const priorSyncCall = Object.getOwnPropertyDescriptor(globalThis, KERNEL_SYNC_CALL_KEY);
    const priorKernelUrl = getKernelWorkerUrl();
    const priorRiftyEnv = riftyProcess.env;
    const sentinelEnv = { RIFTY_TEST_SENTINEL: '1' };
    const sentinelCall = (): null => null;
    const crossOriginDescriptor: PropertyDescriptor = {
      value: false,
      writable: true,
      enumerable: true,
      configurable: true,
    };
    let observed:
      | {
          process: PropertyDescriptor | undefined;
          crossOrigin: PropertyDescriptor | undefined;
          syncCall: PropertyDescriptor | undefined;
          kernelUrl: string | URL | null;
          riftyEnv: Record<string, string | undefined>;
        }
      | undefined;

    try {
      Object.defineProperty(globalThis, 'crossOriginIsolated', crossOriginDescriptor);
      Object.defineProperty(globalThis, KERNEL_SYNC_CALL_KEY, {
        value: sentinelCall,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      setKernelWorkerUrl('https://host.test/original-kernel-worker.js');
      riftyProcess.env = sentinelEnv;

      await runInRifty(
        {
          kind: 'exec-sync',
          stdin: [],
          code: 'process.stdin.resume();',
        },
        { createMessageChannel: () => new MessageChannel() },
      );

      observed = {
        process: Object.getOwnPropertyDescriptor(globalThis, 'process'),
        crossOrigin: Object.getOwnPropertyDescriptor(globalThis, 'crossOriginIsolated'),
        syncCall: Object.getOwnPropertyDescriptor(globalThis, KERNEL_SYNC_CALL_KEY),
        kernelUrl: getKernelWorkerUrl(),
        riftyEnv: riftyProcess.env,
      };
    } finally {
      restoreGlobalDescriptor('process', priorProcess);
      restoreGlobalDescriptor('crossOriginIsolated', priorCrossOrigin);
      restoreGlobalDescriptor(KERNEL_SYNC_CALL_KEY, priorSyncCall);
      restoreKernelWorkerUrl(priorKernelUrl);
      riftyProcess.env = priorRiftyEnv;
      refreshRuntimeJsProcessBuiltin();
    }

    expect(observed?.process).toEqual(priorProcess);
    expect(observed?.crossOrigin).toEqual(crossOriginDescriptor);
    expect(observed?.syncCall).toEqual({
      value: sentinelCall,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    expect(observed?.kernelUrl).toBe('https://host.test/original-kernel-worker.js');
    expect(observed?.riftyEnv).toBe(sentinelEnv);
  });

  it('unwinds acquired globals and closes partial channels when seeded setup throws', async () => {
    const priorProcess = Object.getOwnPropertyDescriptor(globalThis, 'process');
    const priorCrossOrigin = Object.getOwnPropertyDescriptor(globalThis, 'crossOriginIsolated');
    const priorSyncCall = Object.getOwnPropertyDescriptor(globalThis, KERNEL_SYNC_CALL_KEY);
    const priorKernelUrl = getKernelWorkerUrl();
    const priorCwd = getProcessCwd();
    const priorSyncMirror = syncMirror();
    const priorAsyncVfs = asyncVfs();
    const channel = new MessageChannel();
    const closePort1 = vi.spyOn(channel.port1, 'close');
    const closePort2 = vi.spyOn(channel.port2, 'close');
    let channelCalls = 0;
    let observedPort1Closes = 0;
    let observedPort2Closes = 0;
    let caught: unknown;
    let observed:
      | {
          process: PropertyDescriptor | undefined;
          crossOrigin: PropertyDescriptor | undefined;
          syncCall: PropertyDescriptor | undefined;
          kernelUrl: string | URL | null;
          cwd: string;
          mirror: ReturnType<typeof syncMirror>;
        }
      | undefined;

    try {
      await runInRifty(
        {
          kind: 'exec-sync',
          stdin: [],
          code: 'process.stdin.resume();',
        },
        {
          createMessageChannel: () => {
            channelCalls += 1;
            if (channelCalls === 1) return channel;
            throw new Error('message-channel-setup-fault');
          },
        },
      );
    } catch (error) {
      caught = error;
    } finally {
      observed = {
        process: Object.getOwnPropertyDescriptor(globalThis, 'process'),
        crossOrigin: Object.getOwnPropertyDescriptor(globalThis, 'crossOriginIsolated'),
        syncCall: Object.getOwnPropertyDescriptor(globalThis, KERNEL_SYNC_CALL_KEY),
        kernelUrl: getKernelWorkerUrl(),
        cwd: getProcessCwd(),
        mirror: syncMirror(),
      };
      restoreGlobalDescriptor('process', priorProcess);
      restoreGlobalDescriptor('crossOriginIsolated', priorCrossOrigin);
      restoreGlobalDescriptor(KERNEL_SYNC_CALL_KEY, priorSyncCall);
      restoreKernelWorkerUrl(priorKernelUrl);
      setProcessCwd(priorCwd);
      setSyncMirror(priorSyncMirror, priorAsyncVfs ? { async: priorAsyncVfs } : {});
      refreshRuntimeJsProcessBuiltin();
      observedPort1Closes = closePort1.mock.calls.length;
      observedPort2Closes = closePort2.mock.calls.length;
      closePort1.mockRestore();
      closePort2.mockRestore();
      channel.port1.close();
      channel.port2.close();
    }

    expect(caught).toEqual(new Error('message-channel-setup-fault'));
    expect(channelCalls).toBe(2);
    expect(observedPort1Closes).toBe(1);
    expect(observedPort2Closes).toBe(1);
    expect(observed?.process).toEqual(priorProcess);
    expect(observed?.crossOrigin).toEqual(priorCrossOrigin);
    expect(observed?.syncCall).toEqual(priorSyncCall);
    expect(observed?.kernelUrl).toBe(priorKernelUrl);
    expect(observed?.cwd).toBe(priorCwd);
    expect(observed?.mirror).toBe(priorSyncMirror);
  });
});
