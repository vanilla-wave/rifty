import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

const SID_A = 'bu-preview-provenance-a';
const SID_B = 'bu-preview-provenance-b';
const PREVIEW_PORT = 43871;

test('real owner keeps npm nested-shell preview provenance on the launching PTY run', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await gotoHarness(page);

  const result = await page.evaluate(
    async ({ sidA, sidB, previewPort }) => {
      const [realVite, hiddenEmpty] = await Promise.all([
        import('/src/glue/realVite.ts'),
        import('/src/templates/hidden-empty.ts'),
      ]);
      const logs: string[] = [];
      const handle = realVite.startWorkspaceOwner({
        workspaceId: 'browser-unit-preview-provenance',
        root: '/scratch',
        template: hiddenEmpty.HIDDEN_EMPTY_TEMPLATE,
        slug: 'scratch',
        setup: 'instant',
        hiddenEmptyBoot: true,
        onLog: (line: string) => logs.push(line),
      });

      type PreviewEntry = {
        readonly port: number;
        readonly sid: string;
        readonly source: string;
        readonly ptySid?: string;
        readonly ptyRid?: string;
      };

      const cleanupErrors: string[] = [];
      let sessionAOpened = false;
      let sessionBOpened = false;
      let ridA: string | undefined;
      let ridB: string | undefined;
      let runA: Promise<number> | undefined;
      let runB: Promise<number> | undefined;
      let unsubscribePreview: () => void = () => {};
      let previewTimer: number | undefined;
      let outcome:
        | {
            readonly entry: PreviewEntry;
            readonly ridA: string;
            readonly ridB: string;
          }
        | undefined;
      let primaryFailure: unknown;

      const withTimeout = <T>(
        operation: Promise<T>,
        label: string,
        timeoutMs: number,
      ): Promise<T> =>
        new Promise<T>((resolve, reject) => {
          const timer = window.setTimeout(
            () =>
              reject(
                new Error(
                  `${label} timed out after ${timeoutMs}ms; owner logs:\n${logs.slice(-40).join('')}`,
                ),
              ),
            timeoutMs,
          );
          operation.then(
            (value) => {
              clearTimeout(timer);
              resolve(value);
            },
            (error: unknown) => {
              clearTimeout(timer);
              reject(error);
            },
          );
        });

      const recordCleanup = async (label: string, operation: () => Promise<unknown>) => {
        try {
          await operation();
        } catch (error) {
          cleanupErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
        }
      };

      try {
        await withTimeout(handle.ready, 'owner ready', 60_000);
        await withTimeout(
          handle.writeFrameAcked({
            type: 'write',
            path: '/scratch/preview-provenance.mjs',
            data: new TextEncoder().encode(
              [
                "import http from 'node:http';",
                `http.createServer((_req, res) => res.end('A')).listen(${previewPort});`,
                '',
              ].join('\n'),
            ),
          }),
          'server write',
          10_000,
        );
        await withTimeout(
          handle.writeFrameAcked({
            type: 'write',
            path: '/scratch/package.json',
            data: new TextEncoder().encode(
              `${JSON.stringify({
                name: 'browser-unit-preview-provenance',
                private: true,
                type: 'module',
                scripts: { serve: 'node preview-provenance.mjs' },
              })}\n`,
            ),
          }),
          'package write',
          10_000,
        );

        const previewEntry = new Promise<PreviewEntry>((resolve, reject) => {
          previewTimer = window.setTimeout(
            () => reject(new Error(`preview :${previewPort} timed out`)),
            30_000,
          );
          unsubscribePreview = handle.onPreview((frame) => {
            const entry = frame.ports.find((candidate) => candidate.port === previewPort);
            if (entry === undefined) return;
            if (previewTimer !== undefined) clearTimeout(previewTimer);
            resolve(entry);
          });
          handle.requestPreview();
        });

        await withTimeout(handle.openSession(sidA), 'session A open', 10_000);
        sessionAOpened = true;
        await withTimeout(handle.openSession(sidB), 'session B open', 10_000);
        sessionBOpened = true;

        let resolveRidB!: (rid: string) => void;
        const ridBReady = new Promise<string>((resolve) => {
          resolveRidB = resolve;
        });
        runB = handle.exec(sidB, 'sleep 60', {
          cols: 80,
          rows: 24,
          isTTY: false,
          onStart: resolveRidB,
          onChunk: () => {},
        });
        void runB.catch(() => {});
        ridB = await withTimeout(ridBReady, 'run B admission', 10_000);

        let resolveRidA!: (rid: string) => void;
        const ridAReady = new Promise<string>((resolve) => {
          resolveRidA = resolve;
        });
        runA = handle.exec(sidA, `RIFTY_INTERNAL_PTY_SID=${sidB} npm run serve`, {
          cols: 80,
          rows: 24,
          isTTY: false,
          onStart: resolveRidA,
          onChunk: () => {},
        });
        void runA.catch(() => {});
        ridA = await withTimeout(ridAReady, 'run A admission', 10_000);

        outcome = {
          entry: await withTimeout(previewEntry, 'run A preview', 30_000),
          ridA,
          ridB,
        };
      } catch (error) {
        primaryFailure = error;
      } finally {
        unsubscribePreview();
        if (previewTimer !== undefined) clearTimeout(previewTimer);
        if (ridA !== undefined) handle.signal(sidA, ridA);
        if (ridB !== undefined) handle.signal(sidB, ridB);
        if (runA !== undefined) {
          await recordCleanup('run A stop', () => withTimeout(runA!, 'run A stop', 10_000));
        }
        if (runB !== undefined) {
          await recordCleanup('run B stop', () => withTimeout(runB!, 'run B stop', 10_000));
        }
        if (sessionAOpened) {
          await recordCleanup('session A close', () =>
            withTimeout(handle.closeSession(sidA), 'session A close', 10_000),
          );
        }
        if (sessionBOpened) {
          await recordCleanup('session B close', () =>
            withTimeout(handle.closeSession(sidB), 'session B close', 10_000),
          );
        }
        handle.close();
        await recordCleanup('owner close', () => withTimeout(handle.closed, 'owner close', 10_000));
      }

      if (primaryFailure !== undefined) {
        const cleanup = cleanupErrors.length === 0 ? '' : `; cleanup: ${cleanupErrors.join('; ')}`;
        throw new Error(
          `${primaryFailure instanceof Error ? primaryFailure.message : String(primaryFailure)}${cleanup}`,
        );
      }
      if (outcome === undefined) throw new Error('preview provenance run produced no outcome');
      return { ...outcome, cleanupErrors };
    },
    { sidA: SID_A, sidB: SID_B, previewPort: PREVIEW_PORT },
  );

  expect({
    provenance: { ptySid: result.entry.ptySid, ptyRid: result.entry.ptyRid },
    leakedRunB: result.entry.ptySid === SID_B && result.entry.ptyRid === result.ridB,
    cleanupErrors: result.cleanupErrors,
  }).toEqual({
    provenance: { ptySid: SID_A, ptyRid: result.ridA },
    leakedRunB: false,
    cleanupErrors: [],
  });
});
