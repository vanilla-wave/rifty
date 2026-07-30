import { expect, test } from '@playwright/test';

const workspacePath = process.cwd().replaceAll('\\', '/');
const processManagerModuleUrl = `/@fs${workspacePath}/packages/kernel/src/process-manager.ts`;
const spawnWorkerModuleUrl = `/@fs${workspacePath}/packages/kernel/src/spawn-worker.ts`;
const workerEntryModuleUrl = `/@fs${workspacePath}/packages/kernel/src/worker-entry.ts`;
const workerStdioModuleUrl = `/@fs${workspacePath}/packages/kernel/src/worker-stdio-drain.ts`;

test('Chromium MessagePort close cannot attest output drain', async ({ page }) => {
  await page.goto('/unit-harness.html');

  const observed = await page.evaluate(async () => {
    const remoteClose = new MessageChannel();
    const remoteEvents: string[] = [];
    remoteClose.port1.onmessage = (event) => remoteEvents.push(`message:${String(event.data)}`);
    remoteClose.port1.addEventListener('close', () => remoteEvents.push('close'));
    remoteClose.port1.start();
    remoteClose.port2.postMessage('before-close');
    remoteClose.port2.close();

    const localClose = new MessageChannel();
    const locallyDelivered: string[] = [];
    localClose.port1.onmessage = (event) => locallyDelivered.push(String(event.data));
    localClose.port1.start();
    localClose.port2.postMessage('already-posted');
    localClose.port1.close();

    await new Promise((resolve) => setTimeout(resolve, 25));
    return {
      hasOnClose: 'onclose' in remoteClose.port1,
      remoteEvents,
      locallyDelivered,
    };
  });

  expect(observed).toEqual({
    hasOnClose: false,
    remoteEvents: ['message:before-close'],
    locallyDelivered: [],
  });
});

test('natural Worker exit settles only after the final stdout byte reaches the consumer', async ({
  page,
}) => {
  await page.goto('/unit-harness.html');

  const result = await page.evaluate(
    async ({ processManagerUrl, spawnWorkerUrl, workerEntryUrl, workerStdioUrl }) => {
      const [{ ProcessManager }, spawnWorker, workerEntry, workerStdio] = await Promise.all([
        import(/* @vite-ignore */ processManagerUrl),
        import(/* @vite-ignore */ spawnWorkerUrl),
        import(/* @vite-ignore */ workerEntryUrl),
        import(/* @vite-ignore */ workerStdioUrl),
      ]);

      class BoundaryWorker extends EventTarget {
        init: {
          readonly spec: {
            readonly outputState: SharedArrayBuffer;
            readonly stdio: {
              readonly stdout: MessagePort;
              readonly stderr: MessagePort;
              readonly ipc: MessagePort;
            };
          };
        } | null = null;

        postMessage(message: unknown): void {
          const candidate = message as { readonly type?: unknown };
          if (candidate.type === 'init') {
            this.init = message as NonNullable<BoundaryWorker['init']>;
            return;
          }
          this.dispatchEvent(new MessageEvent('message', { data: message }));
        }

        terminate(): void {}
        close(): void {}
      }

      const worker = new BoundaryWorker();
      spawnWorker.setKernelWorkerUrl('browser-unit://kernel-worker');
      spawnWorker.setWorkerFactoryForTests(() => worker);
      try {
        const manager = new ProcessManager();
        const handle = manager.spawnWorker('terminal-drain', {
          entry: {
            kind: 'source',
            code: '',
            sourceUrl: 'browser-unit://terminal-drain',
          },
          argv: ['terminal-drain'],
          env: {},
          cwd: '/',
        });
        if (handle.kind !== 'worker' || worker.init === null) {
          throw new Error('expected a Worker handle and captured init');
        }

        let stdout = '';
        const controlFrames: unknown[] = [];
        const userMessages: unknown[] = [];
        handle.stdout().on('data', (chunk: Uint8Array) => {
          stdout += new TextDecoder().decode(chunk);
        });
        handle.ports.ipc.addEventListener('message', (event: MessageEvent) =>
          controlFrames.push(event.data),
        );
        handle.ports.ipc.start();
        handle.on('message', (message: unknown) => userMessages.push(message));
        const closed = new Promise<{ readonly code: number | null }>((resolve) => {
          handle.once('close', (code: number | null) => resolve({ code }));
        });

        workerStdio
          .bindWorkerStdioOutput(
            worker.init.spec.stdio.stdout,
            worker.init.spec.outputState,
            'stdout',
            worker.init.spec.stdio.ipc,
          )
          .write(new TextEncoder().encode('final-byte'));
        workerEntry.finalizeWorkerEntry(worker, worker.init.spec, { threw: false, code: 0 });
        const expectedOrderFrame = {
          kind: 'control:stdio-order',
          stream: 'stdout',
          order: 0,
          attestation: workerStdio.workerOutputAttestation(worker.init.spec.outputState),
        };

        return await Promise.race([
          closed.then(({ code }) => ({
            state: 'closed',
            code,
            stdout,
            controlFrames,
            userMessages,
            expectedOrderFrame,
          })),
          new Promise<{ readonly state: 'hung'; readonly stdout: string }>((resolve) => {
            setTimeout(() => resolve({ state: 'hung', stdout }), 50);
          }),
        ]);
      } finally {
        spawnWorker.clearWorkerFactoryForTests();
      }
    },
    {
      processManagerUrl: processManagerModuleUrl,
      spawnWorkerUrl: spawnWorkerModuleUrl,
      workerEntryUrl: workerEntryModuleUrl,
      workerStdioUrl: workerStdioModuleUrl,
    },
  );

  expect(result).toEqual({
    state: 'closed',
    code: 0,
    stdout: 'final-byte',
    controlFrames: [result.state === 'closed' ? result.expectedOrderFrame : null],
    userMessages: [],
    expectedOrderFrame: result.state === 'closed' ? result.expectedOrderFrame : null,
  });
});

test('parent cut drains signal/failure and child-sealed peer close to exact admitted targets', async ({
  page,
}) => {
  await page.goto('/unit-harness.html');

  const results = await page.evaluate(
    async ({ processManagerUrl, spawnWorkerUrl, workerStdioUrl }) => {
      const [{ ProcessManager }, spawnWorker, workerStdio] = await Promise.all([
        import(/* @vite-ignore */ processManagerUrl),
        import(/* @vite-ignore */ spawnWorkerUrl),
        import(/* @vite-ignore */ workerStdioUrl),
      ]);

      class HungBoundaryWorker extends EventTarget {
        init: {
          readonly spec: {
            readonly outputState: SharedArrayBuffer;
            readonly stdio: {
              readonly stdout: MessagePort;
              readonly stderr: MessagePort;
              readonly ipc: MessagePort;
            };
          };
        } | null = null;
        terminateCalls = 0;

        postMessage(message: unknown): void {
          const candidate = message as { readonly type?: unknown };
          if (candidate.type === 'init') {
            this.init = message as NonNullable<HungBoundaryWorker['init']>;
          }
        }

        terminate(): void {
          this.terminateCalls++;
        }
      }

      const run = async (terminal: 'signal' | 'failure' | 'peererror') => {
        const worker = new HungBoundaryWorker();
        spawnWorker.setWorkerFactoryForTests(() => worker);
        const manager = new ProcessManager();
        const handle = manager.spawnWorker(terminal, {
          entry: {
            kind: 'source',
            code: 'while (true) {}',
            sourceUrl: `browser-unit://${terminal}`,
          },
          argv: [terminal],
          env: {},
          cwd: '/',
          serve: true,
        });
        if (handle.kind !== 'worker' || worker.init === null) {
          throw new Error('expected a Worker handle and captured init');
        }
        const spec = worker.init.spec;
        const writer = workerStdio.bindWorkerStdioOutput(
          spec.stdio.stdout,
          spec.outputState,
          'stdout',
          spec.stdio.ipc,
        );
        let stdout = '';
        handle.stdout().on('data', (chunk: Uint8Array) => {
          stdout += new TextDecoder().decode(chunk);
        });
        const closed = new Promise<void>((resolve) => handle.once('close', resolve));

        writer.write(new TextEncoder().encode(`before-${terminal}`));
        if (terminal === 'signal') {
          handle.kill('SIGTERM');
        } else if (terminal === 'failure') {
          spec.stdio.ipc.postMessage({ malformed: true });
        } else {
          workerStdio.sealWorkerOutput(spec.outputState);
          spec.stdio.ipc.postMessage({ kind: 'control:peer-closing' });
        }

        if (terminal !== 'signal') await new Promise((resolve) => setTimeout(resolve, 0));
        let postCutError = '';
        try {
          writer.write(new TextEncoder().encode('after-cut'));
        } catch (error) {
          postCutError =
            error instanceof Error ? String(error.cause ?? error.message) : String(error);
        }
        await closed;
        return {
          terminal,
          stdout,
          postCutError,
          terminateCalls: worker.terminateCalls,
          exitCode: handle.exitCode,
          signalCode: handle.signalCode,
          live: manager.get(handle.pid) !== null,
        };
      };

      spawnWorker.setKernelWorkerUrl('browser-unit://kernel-worker');
      try {
        return await Promise.all([run('signal'), run('failure'), run('peererror')]);
      } finally {
        spawnWorker.clearWorkerFactoryForTests();
      }
    },
    {
      processManagerUrl: processManagerModuleUrl,
      spawnWorkerUrl: spawnWorkerModuleUrl,
      workerStdioUrl: workerStdioModuleUrl,
    },
  );

  expect(results).toEqual([
    {
      terminal: 'signal',
      stdout: 'before-signal',
      postCutError: 'Worker stdout write after terminal cut',
      terminateCalls: 1,
      exitCode: null,
      signalCode: 'SIGTERM',
      live: false,
    },
    {
      terminal: 'failure',
      stdout: 'before-failure',
      postCutError: 'Worker stdout write after terminal cut',
      terminateCalls: 1,
      exitCode: 1,
      signalCode: null,
      live: false,
    },
    {
      terminal: 'peererror',
      stdout: 'before-peererror',
      postCutError: 'Worker stdout write after terminal cut',
      terminateCalls: 1,
      exitCode: null,
      signalCode: null,
      live: false,
    },
  ]);
});

test('abrupt unsealed Worker error settles without claiming an exact drain', async ({ page }) => {
  await page.goto('/unit-harness.html');

  const result = await page.evaluate(
    async ({ processManagerUrl, spawnWorkerUrl, workerStdioUrl }) => {
      const [{ ProcessManager }, spawnWorker, workerStdio] = await Promise.all([
        import(/* @vite-ignore */ processManagerUrl),
        import(/* @vite-ignore */ spawnWorkerUrl),
        import(/* @vite-ignore */ workerStdioUrl),
      ]);

      class AbruptBoundaryWorker extends EventTarget {
        init: {
          readonly spec: {
            readonly outputState: SharedArrayBuffer;
            readonly stdio: {
              readonly stdout: MessagePort;
              readonly stderr: MessagePort;
              readonly ipc: MessagePort;
            };
          };
        } | null = null;
        terminateCalls = 0;

        postMessage(message: unknown): void {
          const candidate = message as { readonly type?: unknown };
          if (candidate.type === 'init') {
            this.init = message as NonNullable<AbruptBoundaryWorker['init']>;
          }
        }

        terminate(): void {
          this.terminateCalls++;
        }
      }

      const worker = new AbruptBoundaryWorker();
      spawnWorker.setKernelWorkerUrl('browser-unit://kernel-worker');
      spawnWorker.setWorkerFactoryForTests(() => worker);
      try {
        const manager = new ProcessManager();
        const handle = manager.spawnWorker('abrupt-unsealed', {
          entry: {
            kind: 'source',
            code: '',
            sourceUrl: 'browser-unit://abrupt-unsealed',
          },
          argv: ['abrupt-unsealed'],
          env: {},
          cwd: '/',
          serve: true,
        });
        if (handle.kind !== 'worker' || worker.init === null) {
          throw new Error('expected a Worker handle and captured init');
        }

        let stdout = '';
        let stderr = '';
        let peerErrors = 0;
        handle.stdout().on('data', (chunk: Uint8Array) => {
          stdout += new TextDecoder().decode(chunk);
        });
        handle.stderr().on('data', (chunk: Uint8Array) => {
          stderr += new TextDecoder().decode(chunk);
        });
        handle.on('peererror', () => {
          peerErrors++;
        });
        const closed = new Promise<void>((resolve) => handle.once('close', resolve));

        // Fault injection: physical death stranded an active writer and an
        // undelivered committed stdout frame. Abandon releases waiters but
        // keeps the committed counter untrusted, so no drain target is claimed.
        const words = new Int32Array(worker.init.spec.outputState);
        Atomics.store(words, 1, 1);
        Atomics.store(words, 2, 1);
        const sealedBeforeError = workerStdio.isWorkerOutputChildSealed(
          worker.init.spec.outputState,
        );
        worker.dispatchEvent(new ErrorEvent('error', { message: 'abrupt unsealed worker death' }));

        const state = await Promise.race([
          closed.then(() => 'closed' as const),
          new Promise<'hung'>((resolve) => {
            setTimeout(() => resolve('hung'), 50);
          }),
        ]);
        return {
          state,
          stdout,
          stderr,
          peerErrors,
          sealedBeforeError,
          exitCode: handle.exitCode,
          signalCode: handle.signalCode,
          terminateCalls: worker.terminateCalls,
          live: manager.get(handle.pid) !== null,
          outputPhase: Atomics.load(words, 0),
          activeWriter: Atomics.load(words, 1),
          stdoutCommitted: Atomics.load(words, 2),
        };
      } finally {
        spawnWorker.clearWorkerFactoryForTests();
      }
    },
    {
      processManagerUrl: processManagerModuleUrl,
      spawnWorkerUrl: spawnWorkerModuleUrl,
      workerStdioUrl: workerStdioModuleUrl,
    },
  );

  expect(result).toEqual({
    state: 'closed',
    stdout: '',
    stderr: 'abrupt unsealed worker death\n',
    peerErrors: 0,
    sealedBeforeError: false,
    exitCode: 1,
    signalCode: null,
    terminateCalls: 1,
    live: false,
    outputPhase: 2,
    activeWriter: 0,
    stdoutCommitted: 1,
  });
});

test('module/global error fallback and self.close both settle with exact admitted output', async ({
  page,
}) => {
  await page.goto('/unit-harness.html');

  const result = await page.evaluate(
    async ({ processManagerUrl, spawnWorkerUrl, workerEntryUrl, workerStdioUrl }) => {
      const [{ ProcessManager }, spawnWorker, workerEntry, workerStdio] = await Promise.all([
        import(/* @vite-ignore */ processManagerUrl),
        import(/* @vite-ignore */ spawnWorkerUrl),
        import(/* @vite-ignore */ workerEntryUrl),
        import(/* @vite-ignore */ workerStdioUrl),
      ]);

      class BoundaryWorker extends EventTarget {
        init: {
          readonly spec: {
            readonly outputState: SharedArrayBuffer;
            readonly stdio: {
              readonly stdout: MessagePort;
              readonly stderr: MessagePort;
              readonly ipc: MessagePort;
            };
          };
        } | null = null;
        terminateCalls = 0;
        closeCalls = 0;

        postMessage(message: unknown): void {
          const candidate = message as { readonly type?: unknown };
          if (candidate.type === 'init') {
            this.init = message as NonNullable<BoundaryWorker['init']>;
            return;
          }
          this.dispatchEvent(new MessageEvent('message', { data: message }));
        }
        terminate(): void {
          this.terminateCalls++;
        }
        close(): void {
          this.closeCalls++;
        }
      }

      const spawn = (command: string) => {
        const worker = new BoundaryWorker();
        spawnWorker.setWorkerFactoryForTests(() => worker);
        const manager = new ProcessManager();
        const handle = manager.spawnWorker(command, {
          entry: { kind: 'source', code: '', sourceUrl: `browser-unit://${command}` },
          argv: [command],
          env: {},
          cwd: '/',
          serve: true,
        });
        if (handle.kind !== 'worker' || worker.init === null) {
          throw new Error('expected a Worker handle and captured init');
        }
        return { handle, manager, spec: worker.init.spec, worker };
      };

      spawnWorker.setKernelWorkerUrl('browser-unit://kernel-worker');
      try {
        const globalError = spawn('module-error');
        const globalWriter = workerStdio.bindWorkerStdioOutput(
          globalError.spec.stdio.stdout,
          globalError.spec.outputState,
          'stdout',
          globalError.spec.stdio.ipc,
        );
        let globalStdout = '';
        let globalStderr = '';
        globalError.handle.stdout().on('data', (chunk: Uint8Array) => {
          globalStdout += new TextDecoder().decode(chunk);
        });
        globalError.handle.stderr().on('data', (chunk: Uint8Array) => {
          globalStderr += new TextDecoder().decode(chunk);
        });
        const globalClosed = new Promise<void>((resolve) =>
          globalError.handle.once('close', resolve),
        );
        globalWriter.write(new TextEncoder().encode('before-module-error'));
        const globalSealedBeforeError = workerStdio.sealWorkerOutput(globalError.spec.outputState);
        globalError.worker.dispatchEvent(
          new ErrorEvent('error', { message: 'module parse failed' }),
        );
        await globalClosed;

        const selfClose = spawn('self-close');
        const selfWriter = workerStdio.bindWorkerStdioOutput(
          selfClose.spec.stdio.stdout,
          selfClose.spec.outputState,
          'stdout',
          selfClose.spec.stdio.ipc,
        );
        let selfStdout = '';
        let peerErrors = 0;
        selfClose.handle.stdout().on('data', (chunk: Uint8Array) => {
          selfStdout += new TextDecoder().decode(chunk);
        });
        selfClose.handle.on('peererror', () => {
          peerErrors++;
        });
        const selfClosed = new Promise<void>((resolve) => selfClose.handle.once('close', resolve));
        selfWriter.write(new TextEncoder().encode('before-self-close'));
        let selfCloseSealedBeforeEvent = false;
        const rawIpcPost = selfClose.spec.stdio.ipc.postMessage.bind(selfClose.spec.stdio.ipc);
        Object.defineProperty(selfClose.spec.stdio.ipc, 'postMessage', {
          configurable: true,
          value(message: unknown) {
            if (
              typeof message === 'object' &&
              message !== null &&
              (message as { readonly kind?: unknown }).kind === 'control:peer-closing'
            ) {
              selfCloseSealedBeforeEvent = workerStdio.isWorkerOutputChildSealed(
                selfClose.spec.outputState,
              );
            }
            rawIpcPost(message);
          },
        });
        workerEntry.installWorkerPeerCloseAttestation(selfClose.worker, selfClose.spec);
        selfClose.worker.close();
        await selfClosed;

        return {
          globalError: {
            stdout: globalStdout,
            stderr: globalStderr,
            sealedBeforeError: globalSealedBeforeError,
            exitCode: globalError.handle.exitCode,
            terminateCalls: globalError.worker.terminateCalls,
            live: globalError.manager.get(globalError.handle.pid) !== null,
          },
          selfClose: {
            stdout: selfStdout,
            peerErrors,
            exitCode: selfClose.handle.exitCode,
            closeCalls: selfClose.worker.closeCalls,
            terminateCalls: selfClose.worker.terminateCalls,
            sealedBeforeEvent: selfCloseSealedBeforeEvent,
            live: selfClose.manager.get(selfClose.handle.pid) !== null,
          },
        };
      } finally {
        spawnWorker.clearWorkerFactoryForTests();
      }
    },
    {
      processManagerUrl: processManagerModuleUrl,
      spawnWorkerUrl: spawnWorkerModuleUrl,
      workerEntryUrl: workerEntryModuleUrl,
      workerStdioUrl: workerStdioModuleUrl,
    },
  );

  expect(result).toEqual({
    globalError: {
      stdout: 'before-module-error',
      stderr: 'module parse failed\n',
      sealedBeforeError: true,
      exitCode: 1,
      terminateCalls: 1,
      live: false,
    },
    selfClose: {
      stdout: 'before-self-close',
      peerErrors: 1,
      exitCode: null,
      closeCalls: 1,
      terminateCalls: 1,
      sealedBeforeEvent: true,
      live: false,
    },
  });
});
