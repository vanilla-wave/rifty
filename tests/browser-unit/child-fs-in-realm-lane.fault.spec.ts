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
    const controlled = [];
    for (const mode of [
      'reply-before-ready',
      'messageerror',
      'wrong-reply',
      'duplicate-reply',
      'path-mismatch',
      'asset-path-mismatch',
      'wrong-vite',
      'duplicate-vite',
      'error-envelope',
      'invalid-sample',
      'wrong-backend',
      'wrong-seeded-paths',
      'wrong-written-path',
      'wrong-entries-path',
      'duplicate-entries-path',
      'non-string-entry',
      'extra-ready',
      'extra-booted',
      'extra-seeded',
      'extra-installed',
      'extra-read',
      'extra-written',
      'extra-vite',
      'extra-entries',
      'extra-express',
    ]) {
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
      const reply = (data: Record<string, unknown>) =>
        message(mode === `extra-${String(data.kind)}` ? { ...data, extra: true } : data);
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
              if (mode === 'reply-before-ready') message({ kind: 'booted' });
              else reply({ kind: 'ready' });
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
                  if (command.kind === 'boot') {
                    reply({
                      kind: 'booted',
                      backend: mode === 'wrong-backend' ? 'opfs' : 'memory',
                    });
                  } else if (command.kind === 'seed') {
                    const files = command.files as Record<string, string>;
                    reply({
                      kind: 'seeded',
                      paths:
                        mode === 'wrong-seeded-paths'
                          ? ['/bench/wrong.js']
                          : Object.keys(files)
                              .map((path) => `${String(command.root)}${path}`)
                              .toSorted(),
                    });
                  } else if (command.kind === 'install') {
                    versions = command.dependencies as Record<string, string>;
                    reply({ kind: 'installed' });
                  } else if (command.kind === 'write') {
                    const match = String(command.contents).match(/in-realm-\d+/u);
                    if (match !== null) marker = match[0];
                    reply({
                      kind: 'written',
                      path: mode === 'wrong-written-path' ? '/bench/src/Wrong.jsx' : command.path,
                    });
                  } else if (command.kind === 'vite') {
                    const viteReply = {
                      kind: 'vite',
                      exitCode: 0,
                      rawOutput:
                        mode === 'invalid-sample'
                          ? '✓ 1 modules transformed.\n✓ built in 1s\n'
                          : '✓ 2180 modules transformed.\n✓ built in 1s\n',
                    };
                    if (mode === 'wrong-vite') message({ kind: 'express' });
                    else if (mode === 'duplicate-vite') {
                      message(viteReply);
                      queueMicrotask(() => message(viteReply));
                    } else reply(viteReply);
                  } else if (command.kind === 'readdir') {
                    const path = '/bench/dist/assets/index.js';
                    reply({
                      kind: 'entries',
                      paths:
                        mode === 'wrong-entries-path'
                          ? ['/other/index.js']
                          : mode === 'duplicate-entries-path'
                            ? [path, path]
                            : mode === 'non-string-entry'
                              ? [1]
                              : [path],
                    });
                  } else if (command.kind === 'read') {
                    const path = String(command.path);
                    const dependency = path
                      .slice('/bench/node_modules/'.length)
                      .replace(/\/package\.json$/u, '');
                    reply({
                      kind: 'read',
                      path:
                        mode === 'path-mismatch' ||
                        (mode === 'asset-path-mismatch' && path.startsWith('/bench/dist/assets/'))
                          ? `${path}.wrong`
                          : path,
                      text: path.startsWith('/bench/dist/assets/')
                        ? `const x="${marker}";\n`
                        : `${JSON.stringify({ version: versions[dependency] })}\n`,
                    });
                  } else if (command.kind === 'express') {
                    reply({
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
      const messages: unknown[] = [];
      try {
        await lane.runChildFsInRealmLane(1, {
          open(url: string) {
            const worker = new Worker(
              registryFailure ? url : '/missing-child-fs-in-realm-worker.ts',
              { type: 'module' },
            );
            worker.addEventListener('message', (event) => messages.push(event.data));
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
                    ? { ...message, registryUrl: '/npm-registry/__missing__' }
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
      return { failure, messages, rejected, terminateCalls };
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
    { mode: 'duplicate-reply', posts: 2, rejected: true, terminateCalls: 1 },
    { mode: 'path-mismatch', posts: 4, rejected: true, terminateCalls: 1 },
    { mode: 'asset-path-mismatch', posts: 14, rejected: true, terminateCalls: 1 },
    { mode: 'wrong-vite', posts: 12, rejected: true, terminateCalls: 1 },
    { mode: 'duplicate-vite', posts: 13, rejected: true, terminateCalls: 1 },
    { mode: 'error-envelope', posts: 1, rejected: true, terminateCalls: 1 },
    { mode: 'invalid-sample', posts: 15, rejected: true, terminateCalls: 1 },
    { mode: 'wrong-backend', posts: 1, rejected: true, terminateCalls: 1 },
    { mode: 'wrong-seeded-paths', posts: 2, rejected: true, terminateCalls: 1 },
    { mode: 'wrong-written-path', posts: 11, rejected: true, terminateCalls: 1 },
    { mode: 'wrong-entries-path', posts: 13, rejected: true, terminateCalls: 1 },
    { mode: 'duplicate-entries-path', posts: 13, rejected: true, terminateCalls: 1 },
    { mode: 'non-string-entry', posts: 13, rejected: true, terminateCalls: 1 },
    { mode: 'extra-ready', posts: 0, rejected: true, terminateCalls: 1 },
    { mode: 'extra-booted', posts: 1, rejected: true, terminateCalls: 1 },
    { mode: 'extra-seeded', posts: 2, rejected: true, terminateCalls: 1 },
    { mode: 'extra-installed', posts: 3, rejected: true, terminateCalls: 1 },
    { mode: 'extra-read', posts: 4, rejected: true, terminateCalls: 1 },
    { mode: 'extra-written', posts: 11, rejected: true, terminateCalls: 1 },
    { mode: 'extra-vite', posts: 12, rejected: true, terminateCalls: 1 },
    { mode: 'extra-entries', posts: 13, rejected: true, terminateCalls: 1 },
    { mode: 'extra-express', posts: 15, rejected: true, terminateCalls: 1 },
  ]);
  const envelope = observed.controlled.find(({ mode }) => mode === 'error-envelope')?.failure;
  expect(envelope).toContain('InjectedWorkerError');
  expect(envelope).toContain('injected worker message');
  expect(envelope).toContain('INJECTED_WORKER_STACK');
  expect(observed.missingWorker).toMatchObject({ rejected: true, terminateCalls: 1 });
  expect(observed.missingWorker.failure).not.toBe('');
  expect(observed.registryFailure).toMatchObject({ rejected: true, terminateCalls: 1 });
  const registryEnvelope = observed.registryFailure.messages.find(
    (message) =>
      typeof message === 'object' &&
      message !== null &&
      (message as { readonly kind?: unknown }).kind === 'error',
  ) as
    | {
        readonly kind: 'error';
        readonly error: { readonly name: string; readonly message: string; readonly stack: string };
      }
    | undefined;
  expect(Object.keys(registryEnvelope ?? {}).toSorted()).toEqual(['error', 'kind']);
  expect(Object.keys(registryEnvelope?.error ?? {}).toSorted()).toEqual([
    'message',
    'name',
    'stack',
  ]);
  expect(registryEnvelope?.error.name).toBe('Error');
  expect(registryEnvelope?.error.message).toMatch(/^Failed to fetch packument .+: 404$/u);
  expect(registryEnvelope?.error.stack).toContain(registryEnvelope?.error.message);
  expect(registryEnvelope?.error.stack).toContain('registry.ts');
  expect(observed.registryFailure.failure).toContain(registryEnvelope?.error.name);
  expect(observed.registryFailure.failure).toContain(registryEnvelope?.error.message);
  expect(observed.registryFailure.failure).toContain(registryEnvelope?.error.stack);
});
