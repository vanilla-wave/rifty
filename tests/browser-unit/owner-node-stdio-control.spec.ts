import { expect, test } from '@playwright/test';
import { gotoHarness, sealedWorkbenchFixtureUrl } from './fixtures.ts';

const RESULT_MARKER =
  'RESULT|disconnect=1|input=65,8364,66|eof=1|pre-resume=0|events=stdout:132x43>stderr:132x43>SIGWINCH';

test('sealed terminal preserves paused split UTF-8, EOF, and resize after disconnect', async ({
  page,
}) => {
  await gotoHarness(page);

  const result = await page.evaluate(
    async ({ fixtureUrl, expectedMarker }) => {
      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      const cleanupErrors: string[] = [];
      let terminal: {
        attach(listener: (chunk: string) => void): () => void;
        run(line: string): {
          readonly ready: Promise<void>;
          readonly exited: Promise<{
            readonly code: number | null;
            readonly signal: string | null;
          }>;
          close(): Promise<{ readonly code: number | null; readonly signal: string | null }>;
        };
        write(data: Uint8Array): Promise<void>;
        end(): Promise<void>;
        resize(cols: number, rows: number): Promise<void>;
        close(): Promise<void>;
      } | null = null;
      let detach: (() => void) | null = null;
      let opened = false;
      let primaryFailure: unknown;
      let outcome:
        | {
            readonly exit: { readonly code: number | null; readonly signal: string | null };
            readonly transcript: string;
            readonly acknowledgements: readonly string[];
          }
        | undefined;
      try {
        await fixture.openSealedWorkbenchFixture({
          workspaceId: 'browser-unit-node-stdio-control',
          template: 'hidden-empty',
          persistence: 'ephemeral',
        });
        opened = true;
        const script = `
const events = [];
let input = '';
let eof = false;
let resumed = false;
let dataBeforeResume = false;
let disconnected = false;
let finished = false;

const codePoints = () => Array.from(input, (char) => char.codePointAt(0)).join(',');
const watchdog = setTimeout(() => {
  process.stderr.write('SCRIPT_TIMEOUT|' + JSON.stringify({ input: codePoints(), eof, events }) + '\\n');
  process.exit(124);
}, 15_000);

function finish() {
  if (finished || !eof || events.length < 3) return;
  finished = true;
  clearTimeout(watchdog);
  process.stdout.write(
    'RESULT|disconnect=' + Number(disconnected) +
      '|input=' + codePoints() +
      '|eof=' + Number(eof) +
      '|pre-resume=' + Number(dataBeforeResume) +
      '|events=' + events.join('>') + '\\n',
  );
}

process.stdout.on('resize', () => {
  events.push('stdout:' + process.stdout.columns + 'x' + process.stdout.rows);
  finish();
});
process.stderr.on('resize', () => {
  events.push('stderr:' + process.stderr.columns + 'x' + process.stderr.rows);
  finish();
});
process.on('SIGWINCH', () => {
  events.push('SIGWINCH');
  finish();
});
process.once('disconnect', () => {
  disconnected = true;
});

process.stdin.setEncoding('utf8');
process.stdin.pause();
process.stdin.on('data', (chunk) => {
  if (!resumed) dataBeforeResume = true;
  input += chunk;
});
process.stdin.once('end', () => {
  eof = true;
  process.stdout.write('STATE|eof=1|input=' + codePoints() + '\\n');
  finish();
});

if (typeof process.disconnect !== 'function') {
  throw new Error('process.disconnect is unavailable');
}
process.disconnect();
process.stdout.write('STATE|paused=1|disconnect=' + Number(disconnected) + '\\n');
setTimeout(() => {
  resumed = true;
  process.stdin.resume();
}, 1_000);
        `;
        await fixture.writeProjectText('/scratch/stdio-control.js', script);
        const materialized = await fixture.executeProjectLine('npm install');
        if (materialized.exit !== 0) {
          throw new Error(`Project materialization failed:\n${materialized.out}`);
        }
        const openedTerminal = fixture.currentProject().terminals.open();
        terminal = openedTerminal;
        let transcript = '';
        detach = openedTerminal.attach((chunk: string) => {
          transcript += chunk;
        });
        const run = openedTerminal.run('node stdio-control.js');
        let runFailure: unknown;
        void run.exited.catch((error: unknown) => {
          runFailure = error;
        });

        const waitForOutput = async (marker: string, label: string): Promise<void> => {
          const deadline = performance.now() + 10_000;
          while (!transcript.includes(marker)) {
            if (runFailure !== undefined) throw runFailure;
            if (performance.now() >= deadline) {
              throw new Error(`${label} timed out; transcript:\n${transcript}`);
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        };

        await run.ready;
        await waitForOutput('STATE|paused=1|disconnect=1', 'paused/disconnected marker');
        const acknowledgements: string[] = [];
        for (const [label, bytes] of [
          ['stdin-1', [0x41, 0xe2]],
          ['stdin-2', [0x82]],
          ['stdin-3', [0xac, 0x42]],
        ] as const) {
          await openedTerminal.write(new Uint8Array(bytes));
          acknowledgements.push(label);
        }
        await openedTerminal.end();
        acknowledgements.push('stdin-eof');
        await waitForOutput('STATE|eof=1|input=65,8364,66', 'ordered stdin EOF marker');
        await openedTerminal.resize(132, 43);
        acknowledgements.push('resize-132x43');
        await waitForOutput(expectedMarker, 'exact result marker');
        const exit = await run.exited;
        const closeExit = await run.close();
        if (exit.code !== closeExit.code || exit.signal !== closeExit.signal) {
          throw new Error('Run close changed the exact process exit');
        }
        outcome = { exit, transcript, acknowledgements };
      } catch (error) {
        primaryFailure = error;
      } finally {
        detach?.();
        if (terminal !== null) {
          try {
            await terminal.close();
          } catch (error) {
            cleanupErrors.push(error instanceof Error ? error.message : String(error));
          }
        }
        if (opened) {
          try {
            await fixture.closeSealedWorkbenchFixture();
          } catch (error) {
            cleanupErrors.push(error instanceof Error ? error.message : String(error));
          }
        }
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
      if (outcome === undefined) throw new Error('Node stdio run produced no outcome');
      return outcome;
    },
    { fixtureUrl: sealedWorkbenchFixtureUrl, expectedMarker: RESULT_MARKER },
  );

  expect(result.exit).toEqual({ code: 0, signal: null });
  expect(result.acknowledgements).toEqual([
    'stdin-1',
    'stdin-2',
    'stdin-3',
    'stdin-eof',
    'resize-132x43',
  ]);
  expect(result.transcript.split('\n').filter((line) => line.startsWith('RESULT|'))).toEqual([
    RESULT_MARKER,
  ]);
});
