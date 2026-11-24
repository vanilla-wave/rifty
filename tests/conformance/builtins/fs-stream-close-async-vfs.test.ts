/**
 * The `fs/read-stream-close` / `fs/write-stream-close` parity code on the async
 * `Vfs.openReadable` path (`installMemoryFs`, as the browser hosts' workers) vs
 * live `node -e`. The parity runner installs only the sync mirror, so its read
 * rows take the sync fallback; this is the product path.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as timersPromises from 'node:timers/promises';
import { asyncVfs } from '@riftydev/vfs';
import { installMemoryFs, resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from '../../../packages/runtime-js/src/builtins/fs.ts';
import { getProcessCwd, setProcessCwd } from '../../../packages/runtime-js/src/builtins/process.ts';
import readStreamClose from '../../../tools/node-parity-runner/cases/fs/read-stream-close.case.ts';
import writeStreamClose from '../../../tools/node-parity-runner/cases/fs/write-stream-close.case.ts';

function nodeStdout(code: string): string {
  const cwd = mkdtempSync(join(tmpdir(), 'fs-stream-close-'));
  try {
    const r = spawnSync(process.execPath, ['-e', code], { cwd, encoding: 'utf8', timeout: 30_000 });
    expect(r.status, r.stderr).toBe(0);
    return r.stdout;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

/** Runs the case code against rifty's fs (cwd `/`); resolves after its last line. */
async function riftyStdout(code: string, lastLinePrefix: string): Promise<string> {
  let out = '';
  let done!: () => void;
  const finished = new Promise<void>((resolve) => (done = resolve));
  const log = (line: string): void => {
    out += `${line}\n`;
    if (line.startsWith(lastLinePrefix)) done();
  };
  const modules: Record<string, unknown> = {
    'node:fs': fs.default,
    'node:timers/promises': timersPromises,
  };
  const require = (id: string): unknown => {
    if (!(id in modules)) throw new Error(`unexpected require ${id}`);
    return modules[id];
  };
  new Function('require', 'console', code)(require, { log });
  await finished;
  return out;
}

let priorCwd = '/';
beforeEach(() => {
  priorCwd = getProcessCwd();
  setProcessCwd('/');
});
afterEach(() => {
  setProcessCwd(priorCwd);
  resetSyncMirror();
});

describe('fs stream close() on the async openReadable path vs live Node', () => {
  for (const [label, c, last] of [
    ['ReadStream', readStreamClose, 'proto close:'],
    ['WriteStream', writeStreamClose, 'destroySoon === end:'],
  ] as const) {
    it(label, async () => {
      installMemoryFs();
      expect(asyncVfs()).not.toBeNull();
      expect(await riftyStdout(c.code, last)).toBe(nodeStdout(c.code));
    });
  }
});
