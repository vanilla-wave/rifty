import { installProcessGlobals, riftyProcess } from '@riftydev/runtime-js/builtins/process';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runNoCoiProjectCommand } from './no-coi-project-command.ts';

// ADR-0445 in-process host: the no-COI toolchain realm's active process is the
// shared `riftyProcess` (runtime-js worker entry `installProcessGlobals`). Its
// terminal ends the invocation's loop as Node's process ends: status from the
// terminal, no later callback of that process runs, the next invocation is clean.
// Node v24.16.0: `setTimeout(write, 20); process.exit(3)` → status 3, no write;
// a throwing `uncaughtException` listener → status 7, no write.

const nativeProcess = Object.getOwnPropertyDescriptor(globalThis, 'process');

beforeAll(() => {
  installProcessGlobals();
});

afterEach(() => {
  if (nativeProcess) Object.defineProperty(globalThis, 'process', nativeProcess);
  resetSyncMirror();
});

function fixture(files: Record<string, string>) {
  const fs = new MemoryFsSync();
  fs.mkdirSync('/project', { recursive: true });
  fs.loadFixture(files);
  setSyncMirror(fs);
  Object.defineProperty(globalThis, 'process', { configurable: true, value: riftyProcess });
  const run = async (command: string) => {
    let stdout = '';
    let stderr = '';
    const result = await runNoCoiProjectCommand(
      { project: { root: '/project' }, command, cwd: '/project', env: {} },
      new AbortController().signal,
      {
        fs,
        flush: async () => 'memory',
        effects: () => 'unknown',
        onOutput(chunk, stream) {
          if (stream === 'stdout') stdout += chunk;
          else stderr += chunk;
        },
      },
    );
    return { ...result, stdout, stderr };
  };
  return { fs, run };
}

// `node:timers` = the realm's timer globals (`installTimerGlobals`) under Node vitest.
const LATE_WRITE =
  "require('node:timers').setTimeout(() => require('node:fs').writeFileSync('/project/late.txt', 'late'), 20);";

describe('no-COI command process terminal (ADR-0445)', () => {
  it('ends the loop at process.exit: its status, no later timer effect', async () => {
    const { fs, run } = fixture({
      '/project/exit.cjs': `${LATE_WRITE}\nprocess.exit(3);`,
      '/project/ok.cjs': "console.log('next');",
    });

    expect(await run('node exit.cjs')).toMatchObject({ status: 'exited', exitCode: 3 });
    await run('sleep 0.05');
    expect(fs.existsSync('/project/late.txt')).toBe(false);
    expect(await run('node ok.cjs')).toMatchObject({ exitCode: 0, stdout: 'next\n' });
  });

  it('ends the loop at a throwing uncaughtException listener with status 7', async () => {
    const { fs, run } = fixture({
      '/project/listener.cjs': `process.on('uncaughtException', () => { throw new Error('LISTENER'); });
${LATE_WRITE}
throw new Error('entry');`,
      '/project/ok.cjs': "console.log('next');",
    });

    const result = await run('node listener.cjs');
    expect(result).toMatchObject({ status: 'exited', exitCode: 7 });
    expect(result.stderr).toContain('Error: LISTENER');
    await run('sleep 0.05');
    expect(fs.existsSync('/project/late.txt')).toBe(false);
    expect(await run('node ok.cjs')).toMatchObject({ exitCode: 0, stdout: 'next\n' });
  });
});
