import { expect, test } from '@playwright/test';
import { gotoHarness, sealedWorkbenchFixtureUrl } from './fixtures.ts';

const PREVIEW_PORT = 43871;

test('semantic preview stays owned by its launching terminal run', async ({ page }) => {
  test.setTimeout(150_000);
  await gotoHarness(page);

  const result = await page.evaluate(
    async ({ fixtureUrl, previewPort }) => {
      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      type Exit = { readonly code: number | null; readonly signal: string | null };
      type Run = {
        readonly ready: Promise<void>;
        readonly exited: Promise<Exit>;
        stop(): Promise<Exit>;
        close(): Promise<Exit>;
      };
      type Terminal = {
        attach(listener: (chunk: string) => void): () => void;
        run(line: string): Run;
        close(): Promise<void>;
      };
      const cleanupErrors: string[] = [];
      let opened = false;
      let terminalA: Terminal | null = null;
      let terminalB: Terminal | null = null;
      let runA: Run | null = null;
      let runB: Run | null = null;
      let detachA: (() => void) | null = null;
      let transcriptA = '';
      let primaryFailure: unknown;
      let outcome:
        | {
            readonly live: readonly unknown[];
            readonly afterSiblingStop: readonly unknown[];
            readonly afterLaunchingStop: readonly unknown[];
            readonly stopA: Exit;
            readonly closeA: Exit;
            readonly stopB: Exit;
            readonly closeB: Exit;
          }
        | undefined;

      const waitUntil = async (
        predicate: () => boolean,
        label: string,
        timeoutMs: number,
      ): Promise<void> => {
        const deadline = performance.now() + timeoutMs;
        while (!predicate()) {
          if (performance.now() >= deadline) {
            throw new Error(`${label} timed out after ${String(timeoutMs)}ms`);
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      };
      const recordCleanup = async (operation: () => Promise<unknown>): Promise<void> => {
        try {
          await operation();
        } catch (error) {
          cleanupErrors.push(error instanceof Error ? error.message : String(error));
        }
      };

      try {
        await fixture.openSealedWorkbenchFixture({
          workspaceId: 'browser-unit-preview-provenance',
          template: 'hidden-empty',
          persistence: 'ephemeral',
        });
        opened = true;
        await fixture.writeProjectText(
          '/scratch/preview-provenance.mjs',
          [
            "import http from 'node:http';",
            `http.createServer((_req, res) => res.end('A')).listen(${String(previewPort)});`,
            '',
          ].join('\n'),
        );
        const materialized = await fixture.executeProjectLine('npm install');
        if (materialized.exit !== 0) {
          throw new Error(`Project materialization failed:\n${materialized.out}`);
        }
        await fixture.writeProjectText(
          '/scratch/package.json',
          `${JSON.stringify({
            name: 'browser-unit-preview-provenance',
            private: true,
            type: 'module',
            scripts: { serve: 'node preview-provenance.mjs' },
          })}\n`,
        );

        const project = fixture.currentProject();
        const previews = fixture.currentSessionTools().previews;
        const openedTerminalA = project.terminals.open();
        const openedTerminalB = project.terminals.open();
        terminalA = openedTerminalA;
        terminalB = openedTerminalB;
        detachA = openedTerminalA.attach((chunk: string) => {
          transcriptA += chunk;
        });
        runB = openedTerminalB.run('sleep 60');
        await runB.ready;
        runA = openedTerminalA.run('RIFTY_INTERNAL_PTY_SID=sealed-sibling npm run serve');
        await runA.ready;

        await Promise.race([
          waitUntil(
            () =>
              previews
                .snapshot()
                .some((entry: { readonly port: number }) => entry.port === previewPort),
            'launching-run preview',
            30_000,
          ),
          runA.exited.then((exit) => {
            throw new Error(
              `launching run exited before preview: ${JSON.stringify(exit)}\n${transcriptA}`,
            );
          }),
        ]);
        const live = previews.snapshot();

        const stopB = await runB.stop();
        const closeB = await runB.close();
        runB = null;
        await new Promise((resolve) => setTimeout(resolve, 100));
        const afterSiblingStop = previews.snapshot();

        const stopA = await runA.stop();
        const closeA = await runA.close();
        runA = null;
        await waitUntil(
          () => previews.snapshot().length === 0,
          'launching preview withdrawal',
          30_000,
        );

        outcome = {
          live,
          afterSiblingStop,
          afterLaunchingStop: previews.snapshot(),
          stopA,
          closeA,
          stopB,
          closeB,
        };
      } catch (error) {
        primaryFailure = error;
      } finally {
        detachA?.();
        if (runA !== null) await recordCleanup(() => runA?.stop() ?? Promise.resolve());
        if (runB !== null) await recordCleanup(() => runB?.stop() ?? Promise.resolve());
        if (terminalA !== null) await recordCleanup(() => terminalA?.close() ?? Promise.resolve());
        if (terminalB !== null) await recordCleanup(() => terminalB?.close() ?? Promise.resolve());
        if (opened) await recordCleanup(() => fixture.closeSealedWorkbenchFixture());
      }
      if (primaryFailure !== undefined) {
        const cleanup = cleanupErrors.length === 0 ? '' : `; cleanup: ${cleanupErrors.join('; ')}`;
        throw new Error(
          `${primaryFailure instanceof Error ? primaryFailure.message : String(primaryFailure)}${cleanup}`,
        );
      }
      if (cleanupErrors.length > 0) {
        throw new Error(`cleanup failed: ${cleanupErrors.join('; ')}`);
      }
      if (outcome === undefined) throw new Error('Preview provenance run produced no outcome');
      return outcome;
    },
    { fixtureUrl: sealedWorkbenchFixtureUrl, previewPort: PREVIEW_PORT },
  );

  expect(result.live).toEqual([expect.objectContaining({ port: PREVIEW_PORT, source: 'node' })]);
  expect(result.afterSiblingStop).toEqual(result.live);
  expect(result.afterLaunchingStop).toEqual([]);
  expect(result.stopA).toEqual(result.closeA);
  expect(result.stopB).toEqual(result.closeB);
});
