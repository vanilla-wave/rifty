import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

const RESULT_MARKER =
  'RESULT|disconnect=1|input=65,8364,66|eof=1|pre-resume=0|events=stdout:132x43>stderr:132x43>SIGWINCH';

/**
 * Full page -> owner -> supervised Node-worker control path. The in-realm stdin
 * and IPC suites cannot prove that PTY ACKs reach the same live child after a
 * logical process.disconnect().
 */
test('node child preserves paused split UTF-8, EOF, and resize after logical disconnect', async ({
  page,
}) => {
  await gotoHarness(page);

  const result = await page.evaluate(async (expectedMarker) => {
    const [realVite, hiddenEmpty] = await Promise.all([
      import('/src/glue/realVite.ts'),
      import('/src/templates/hidden-empty.ts'),
    ]);
    const logs: string[] = [];
    const sid = 'bu-node-stdio-control';
    const handle = realVite.startWorkspaceOwner({
      workspaceId: 'browser-unit-node-stdio-control',
      root: '/scratch',
      template: hiddenEmpty.HIDDEN_EMPTY_TEMPLATE,
      slug: 'scratch',
      setup: 'instant',
      hiddenEmptyBoot: true,
      onLog: (line: string) => logs.push(line),
    });
    let sessionOpened = false;
    let primaryFailure: unknown;
    const cleanupErrors: string[] = [];
    let runResult:
      | { readonly exit: number; readonly transcript: string; readonly acknowledgements: string[] }
      | undefined;

    function withTimeout<T>(operation: Promise<T>, label: string, timeoutMs: number): Promise<T> {
      return new Promise<T>((resolve, reject) => {
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
    }

    try {
      await withTimeout(handle.ready, 'owner ready', 60_000);

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
      await withTimeout(
        handle.writeFrameAcked({
          type: 'write',
          path: '/scratch/stdio-control.js',
          data: new TextEncoder().encode(script),
        }),
        'script write ack',
        10_000,
      );

      await withTimeout(handle.openSession(sid), 'session open', 10_000);
      sessionOpened = true;

      let transcript = '';
      let execFailure: unknown;
      let resolveRid!: (rid: string) => void;
      const ridReady = new Promise<string>((resolve) => {
        resolveRid = resolve;
      });
      const execPromise = handle.exec(sid, 'node stdio-control.js', {
        cols: 80,
        rows: 24,
        isTTY: true,
        onStart: resolveRid,
        onChunk: (chunk: string) => {
          transcript += chunk;
        },
      });
      void execPromise.catch((error: unknown) => {
        execFailure = error;
      });

      async function waitForOutput(marker: string, label: string): Promise<void> {
        const deadline = performance.now() + 10_000;
        while (!transcript.includes(marker)) {
          if (execFailure !== undefined) throw execFailure;
          if (performance.now() >= deadline) {
            throw new Error(`${label} timed out; transcript:\n${transcript}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      const rid = await withTimeout(ridReady, 'run start', 10_000);
      await waitForOutput('STATE|paused=1|disconnect=1', 'paused/disconnected marker');

      const acknowledgements: string[] = [];
      const writeAcked = async (label: string, data: number[]): Promise<void> => {
        await withTimeout(handle.writeStdin(sid, rid, new Uint8Array(data)), label, 10_000);
        acknowledgements.push(label);
      };
      // A + the first byte of EUR, its middle byte, then its final byte + B.
      await writeAcked('stdin-1', [0x41, 0xe2]);
      await writeAcked('stdin-2', [0x82]);
      await writeAcked('stdin-3', [0xac, 0x42]);
      await withTimeout(handle.endStdin(sid, rid), 'stdin-eof', 10_000);
      acknowledgements.push('stdin-eof');

      await waitForOutput('STATE|eof=1|input=65,8364,66', 'ordered stdin EOF marker');
      await withTimeout(handle.resize(sid, rid, 132, 43), 'resize-132x43', 10_000);
      acknowledgements.push('resize-132x43');
      await waitForOutput(expectedMarker, 'exact result marker');

      const exit = await withTimeout(execPromise, 'node child exit', 10_000);
      runResult = { exit, transcript, acknowledgements };
    } catch (error) {
      primaryFailure = error;
    } finally {
      if (sessionOpened) {
        try {
          await withTimeout(handle.closeSession(sid), 'session close', 10_000);
        } catch (error) {
          cleanupErrors.push(error instanceof Error ? error.message : String(error));
        }
      }
      handle.close();
      try {
        await withTimeout(handle.closed, 'owner close', 10_000);
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (primaryFailure !== undefined) throw primaryFailure;
    if (cleanupErrors.length > 0) throw new Error(`cleanup failed: ${cleanupErrors.join('; ')}`);
    if (runResult === undefined) throw new Error('node child run produced no result');
    return runResult;
  }, RESULT_MARKER);

  expect(result.exit).toBe(0);
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
