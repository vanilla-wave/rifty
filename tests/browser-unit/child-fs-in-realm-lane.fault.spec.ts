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
    type Mode = 'duplicate-reply' | 'invalid-sample' | 'reply-before-ready' | 'wrong-reply';
    const controlled = [];
    for (const mode of [
      'reply-before-ready',
      'wrong-reply',
      'duplicate-reply',
      'invalid-sample',
    ] as const satisfies readonly Mode[]) {
      const listeners = new Map<string, Set<Listener>>();
      let marker = 'in-realm-3';
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
      try {
        await lane.runChildFsInRealmLane(3, {
          open: () => {
            queueMicrotask(() =>
              message({ kind: mode === 'reply-before-ready' ? 'booted' : 'ready' }),
            );
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
                    message({ kind: 'installed', versions: {} });
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
                    message({ kind: 'seeded', paths: Object.keys(files).toSorted() });
                  } else if (command.kind === 'install') {
                    message({ kind: 'installed', versions: command.dependencies });
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
                    message({ kind: 'read', path: command.path, text: `const x="${marker}";\n` });
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
      } catch {
        rejected = true;
      }
      controlled.push({ mode, posts: posts.length, rejected, terminateCalls });
    }

    const runRealFailure = async (registryFailure: boolean) => {
      let rejected = false;
      let terminateCalls = 0;
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
      } catch {
        rejected = true;
      }
      return { rejected, terminateCalls };
    };

    return {
      controlled,
      missingWorker: await runRealFailure(false),
      registryFailure: await runRealFailure(true),
    };
  }, laneFixtureUrl);

  expect(observed.controlled).toEqual([
    { mode: 'reply-before-ready', posts: 0, rejected: true, terminateCalls: 1 },
    { mode: 'wrong-reply', posts: 1, rejected: true, terminateCalls: 1 },
    { mode: 'duplicate-reply', posts: 2, rejected: true, terminateCalls: 1 },
    { mode: 'invalid-sample', posts: 8, rejected: true, terminateCalls: 1 },
  ]);
  expect(observed.missingWorker).toEqual({ rejected: true, terminateCalls: 1 });
  expect(observed.registryFailure).toEqual({ rejected: true, terminateCalls: 1 });
});
