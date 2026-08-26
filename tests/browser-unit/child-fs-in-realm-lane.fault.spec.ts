import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const laneFixtureUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/child-fs-in-realm-lane.ts`;

test('protocol corruption and real Worker failures reject and terminate once', async ({ page }) => {
  test.setTimeout(240_000);
  await gotoHarness(page);
  const observed = await page.evaluate(async (laneUrl) => {
    const lane = await import(/* @vite-ignore */ laneUrl);

    type Listener = EventListenerOrEventListenerObject;
    type Mode =
      | 'duplicate-reply'
      | 'error-envelope'
      | 'invalid-sample'
      | 'malformed-reply'
      | 'messageerror'
      | 'path-mismatch'
      | 'reply-before-ready'
      | 'wrong-reply';
    const controlled = [];
    for (const mode of [
      'reply-before-ready',
      'messageerror',
      'wrong-reply',
      'malformed-reply',
      'duplicate-reply',
      'path-mismatch',
      'error-envelope',
      'invalid-sample',
    ] as const satisfies readonly Mode[]) {
      const listeners = new Map<string, Set<Listener>>();
      let marker = 'in-realm-3';
      let versions: Record<string, string> = {};
      let terminateCalls = 0;
      const posts: unknown[] = [];
      const emit = (type: string, event: Event) => {
        for (const listener of listeners.get(type) ?? []) {
          if (typeof listener === 'function') listener(event);
          else listener.handleEvent(event);
        }
      };
      const message = (data: unknown) => emit('message', new MessageEvent('message', { data }));
      let rejected = false;
      let failure = '';
      try {
        await lane.runChildFsInRealmLane(3, {
          open: () => {
            queueMicrotask(() => {
              if (mode === 'messageerror') {
                emit('messageerror', new MessageEvent('messageerror'));
                return;
              }
              message({ kind: mode === 'reply-before-ready' ? 'booted' : 'ready' });
            });
            return {
              addEventListener(type: string, listener: Listener) {
                const entries = listeners.get(type) ?? new Set<Listener>();
                entries.add(listener);
                listeners.set(type, entries);
              },
              removeEventListener(type: string, listener: Listener) {
                listeners.get(type)?.delete(listener);
              },
              postMessage(command: Record<string, unknown>) {
                posts.push(command);
                queueMicrotask(() => {
                  if (mode === 'wrong-reply') {
                    message({ kind: 'installed' });
                    return;
                  }
                  if (mode === 'malformed-reply') {
                    message({ kind: 'booted', backend: 'memory', extra: true });
                    return;
                  }
                  if (mode === 'error-envelope') {
                    message({
                      kind: 'error',
                      error: {
                        name: 'InjectedWorkerError',
                        message: 'injected worker message',
                        stack: 'INJECTED_WORKER_STACK',
                      },
                    });
                    return;
                  }
                  if (mode === 'duplicate-reply' && command.kind === 'boot') {
                    message({ kind: 'booted', backend: 'memory' });
                    queueMicrotask(() => message({ kind: 'booted', backend: 'memory' }));
                    return;
                  }
                  if (command.kind === 'boot') message({ kind: 'booted', backend: 'memory' });
                  else if (command.kind === 'seed') {
                    const files = command.files as Record<string, string>;
                    message({
                      kind: 'seeded',
                      paths: Object.keys(files)
                        .map((path) => `${String(command.root)}${path}`)
                        .toSorted(),
                    });
                  } else if (command.kind === 'install') {
                    versions = command.dependencies as Record<string, string>;
                    message({ kind: 'installed' });
                  } else if (command.kind === 'write') {
                    const match = String(command.contents).match(/in-realm-\d+/u);
                    if (match !== null) marker = match[0];
                    message({ kind: 'written', path: command.path });
                  } else if (command.kind === 'vite') {
                    message({
                      kind: 'vite',
                      exitCode: 0,
                      rawOutput: '✓ 1 modules transformed.\n✓ built in 1s\n',
                    });
                  } else if (command.kind === 'readdir') {
                    message({ kind: 'entries', paths: ['/bench/dist/assets/index.js'] });
                  } else if (command.kind === 'read') {
                    const path = String(command.path);
                    const dependency = path
                      .slice('/bench/node_modules/'.length)
                      .replace(/\/package\.json$/u, '');
                    message({
                      kind: 'read',
                      path: mode === 'path-mismatch' ? `${path}.wrong` : path,
                      text: path.startsWith('/bench/dist/assets/')
                        ? `const x="${marker}";\n`
                        : `${JSON.stringify({ version: versions[dependency] })}\n`,
                    });
                  } else if (command.kind === 'express') {
                    message({
                      kind: 'express',
                      exitCode: 0,
                      rawOutput: `RIFTY_EXPRESS_READY ${marker} 1\nRIFTY_EXPRESS_CLOSED ${marker}\n`,
                    });
                  }
                });
              },
              terminate() {
                terminateCalls += 1;
              },
            };
          },
        });
      } catch (error) {
        rejected = true;
        const inspected = error instanceof Error ? error : new Error(String(error));
        failure = `${inspected.name}\n${inspected.message}\n${inspected.stack ?? ''}`;
      }
      controlled.push({ failure, mode, posts: posts.length, rejected, terminateCalls });
    }

    const runRealFailure = async (registryFailure: boolean) => {
      let rejected = false;
      let terminateCalls = 0;
      let failure = '';
      try {
        await lane.runChildFsInRealmLane(1, {
          open(url: string) {
            const worker = new Worker(
              registryFailure ? url : '/missing-child-fs-in-realm-worker.ts',
              { type: 'module' },
            );
            return {
              addEventListener(
                type: 'message' | 'messageerror' | 'error',
                listener: EventListenerOrEventListenerObject,
              ) {
                worker.addEventListener(type, listener);
              },
              removeEventListener(
                type: 'message' | 'messageerror' | 'error',
                listener: EventListenerOrEventListenerObject,
              ) {
                worker.removeEventListener(type, listener);
              },
              postMessage(message: Record<string, unknown>) {
                worker.postMessage(
                  registryFailure && message.kind === 'install'
                    ? { ...message, registryUrl: '/missing-npm-registry' }
                    : message,
                );
              },
              terminate() {
                terminateCalls += 1;
                worker.terminate();
              },
            };
          },
        });
      } catch (error) {
        rejected = true;
        const inspected = error instanceof Error ? error : new Error(String(error));
        failure = `${inspected.name}\n${inspected.message}\n${inspected.stack ?? ''}`;
      }
      return { failure, rejected, terminateCalls };
    };

    return {
      controlled,
      missingWorker: await runRealFailure(false),
      registryFailure: await runRealFailure(true),
    };
  }, laneFixtureUrl);

  expect(observed.controlled.map(({ failure: _failure, ...entry }) => entry)).toEqual([
    { mode: 'reply-before-ready', posts: 0, rejected: true, terminateCalls: 1 },
    { mode: 'messageerror', posts: 0, rejected: true, terminateCalls: 1 },
    { mode: 'wrong-reply', posts: 1, rejected: true, terminateCalls: 1 },
    { mode: 'malformed-reply', posts: 1, rejected: true, terminateCalls: 1 },
    { mode: 'duplicate-reply', posts: 2, rejected: true, terminateCalls: 1 },
    { mode: 'path-mismatch', posts: 4, rejected: true, terminateCalls: 1 },
    { mode: 'error-envelope', posts: 1, rejected: true, terminateCalls: 1 },
    { mode: 'invalid-sample', posts: 15, rejected: true, terminateCalls: 1 },
  ]);
  const envelope = observed.controlled.find(({ mode }) => mode === 'error-envelope')?.failure;
  expect(envelope).toContain('InjectedWorkerError');
  expect(envelope).toContain('injected worker message');
  expect(envelope).toContain('INJECTED_WORKER_STACK');
  expect(observed.missingWorker).toMatchObject({ rejected: true, terminateCalls: 1 });
  expect(observed.missingWorker.failure).not.toBe('');
  expect(observed.registryFailure).toMatchObject({ rejected: true, terminateCalls: 1 });
  expect(observed.registryFailure.failure).toContain('/missing-npm-registry');
});
