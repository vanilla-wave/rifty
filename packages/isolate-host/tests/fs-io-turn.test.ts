/**
 * Unit runtime-js/fs-callbacks-io-turn, isolate guest: fs completions in their own loop
 * turn (the parity case `fs/callback-turn-order`), the lifecycle around operations in
 * flight, against live `node` over the same code. ESM rows and `worker.terminate()` are
 * the Workbench/SDK carrier's (`tests/browser-unit/fixtures/fs-io-turn-programs.ts`):
 * this host has no ES module loader and no `worker_threads`. `fs/callback-phase-order` is
 * declared here (`runtime-js/loop-phase-of-current-turn`): the guest runs on its own thread beside
 * the host loop, so its immediates and timers interleave by race.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FS_IO_TURN_CHAIN,
  FS_IO_TURN_EXIT_CHILD,
} from '../../../tests/browser-unit/fixtures/fs-io-turn-programs.ts';
import appendFileRm from '../../../tools/node-parity-runner/cases/fs/append-file-rm-callbacks.case.ts';
import argumentsAtCall from '../../../tools/node-parity-runner/cases/fs/async-arguments-at-call.case.ts';
import optionsAtCall from '../../../tools/node-parity-runner/cases/fs/async-options-at-call.case.ts';
import callbackTurnOrder from '../../../tools/node-parity-runner/cases/fs/callback-turn-order.case.ts';
import dirReadTurns from '../../../tools/node-parity-runner/cases/fs/dir-read-turns.case.ts';
import { createSandbox, runCode } from '../src/index.ts';
import { inSandbox } from './package-closure.ts';
import { nodeEval } from './support.ts';

/** `node <file> [arg]` in a fresh dir; the file `out` it leaves, if any. */
function nodeFile(source: string, arg: string, out: string) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'isolate-fs-io-turn-')));
  try {
    writeFileSync(join(dir, 'main.cjs'), source);
    const r = spawnSync(process.execPath, ['main.cjs', arg], {
      cwd: dir,
      env: {},
      encoding: 'utf8',
      timeout: 30_000,
    });
    let file: string | undefined;
    try {
      file = readFileSync(join(dir, out), 'utf8');
    } catch {}
    return { stdout: r.stdout, exitCode: r.status, file };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('fs completions take their own loop turn, as in Node (isolate guest)', () => {
  it('callback-turn-order: order, 256-read interval ticks, the operation moment', async () => {
    // Where a due timer lands against a completion races here: the guest's thread runs beside the
    // host loop (`runtime-js/loop-phase-of-current-turn`). The callback's place against ticks,
    // promises and immediates is compared; the timers' is not.
    const untimed = (out: string) => out.replace(/,?timeout[<>]/gu, '').replace(/: ,/gu, ': ');
    const node = nodeEval(callbackTurnOrder.code);
    expect(node.code).toBe(0);
    const result = await runCode(callbackTurnOrder.code);
    expect(result.termination).toBeUndefined();
    expect({ stdout: untimed(result.stdout), exitCode: result.exitCode }).toEqual({
      stdout: untimed(node.stdout),
      exitCode: 0,
    });
  }, 60_000);

  for (const [name, testCase] of [
    ['dir-read-turns', dirReadTurns],
    ['async-arguments-at-call', argumentsAtCall],
    ['async-options-at-call', optionsAtCall],
    ['append-file-rm-callbacks', appendFileRm],
  ] as const) {
    it(`parity case fs/${name}`, async () => {
      const node = nodeEval(testCase.code);
      const result = await runCode(testCase.code);
      expect({ stdout: result.stdout, exitCode: result.exitCode }).toEqual({
        stdout: node.stdout,
        exitCode: node.code,
      });
    }, 60_000);
  }

  it('a program whose only work is 1000 chained readFile callbacks: exit after the last', async () => {
    const node = nodeEval(FS_IO_TURN_CHAIN);
    const result = await runCode(FS_IO_TURN_CHAIN);
    expect({ stdout: result.stdout, exitCode: result.exitCode }).toEqual({
      stdout: node.stdout,
      exitCode: node.code,
    });
  }, 60_000);

  // The process end runs a submitted write without its callback (Node joins its threadpool).
  for (const mode of ['exit', 'throw', 'reject', 'exit-listener']) {
    it(`process end (${mode}) with a write submitted: the file Node leaves, no callback`, async () => {
      const source = FS_IO_TURN_EXIT_CHILD.replace(
        'const mode = process.argv[2];',
        `const mode = ${JSON.stringify(mode)};`,
      );
      const node = nodeFile(source, mode, 'e.txt');
      const r = await inSandbox(new Map([['main.cjs', Buffer.from(source)]]), 'main.cjs', 'e.txt');
      expect({
        stdout: r.stdout,
        exitCode: r.exitCode,
        file: r.file === undefined ? undefined : Buffer.from(r.file).toString('utf8'),
      }).toEqual(node);
    }, 60_000);
  }

  it('a sandbox stop (timeout) mid fs chain: no hang, the sandbox runs the next call', async () => {
    const sb = await createSandbox();
    try {
      await sb.writeFile(
        'loop.js',
        "const fs = require('fs'); const step = () => fs.stat('.', step); step();",
      );
      await sb.writeFile('after.js', "require('fs').stat('.', () => console.log('next call'));");
      const stopped = await sb.exec('loop.js', { timeoutMs: 300 });
      expect(stopped.termination).toBe('timeout');
      const next = await sb.exec('after.js');
      expect({ stdout: next.stdout, exitCode: next.exitCode }).toEqual({
        stdout: 'next call\n',
        exitCode: 0,
      });
    } finally {
      await sb.destroy();
    }
  }, 60_000);
});
