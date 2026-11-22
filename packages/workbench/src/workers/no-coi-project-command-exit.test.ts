import { installProcessGlobals, riftyProcess } from '@riftydev/runtime-js/builtins/process';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runNoCoiProjectCommand } from './no-coi-project-command.ts';

// ADR-0445 in-process host: the no-COI toolchain realm's active process is the
// shared `riftyProcess` (runtime-js worker entry `installProcessGlobals`). Its
// terminal ends the invocation's loop as Node's process ends: status from the
// terminal, no later callback of that process runs, the next invocation is clean.
// Node v24.16.0: `setTimeout(write, 20 | 0); process.exit(3)` → status 3, no write;
// a throwing `uncaughtException` listener → status 7, no write; a no-listener
// entry throw → its stack on stderr (fd 2, past a patched process.stderr.write),
// status 1 (an 'exit' listener's exitCode wins; a later microtask's does not),
// no write, also for a 0 ms timer queued before it.

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
const NEXT_WRITE =
  "require('node:timers').setTimeout(() => require('node:fs').writeFileSync('/project/late.txt', 'late'), 0);";

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

  it('ends the loop at process.exit before a 0 ms timer queued ahead of the drain', async () => {
    const { fs, run } = fixture({ '/project/exit.cjs': `${NEXT_WRITE}\nprocess.exit(3);` });

    expect(await run('node exit.cjs')).toMatchObject({ status: 'exited', exitCode: 3 });
    await run('sleep 0.05');
    expect(fs.existsSync('/project/late.txt')).toBe(false);
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

  it.each([
    ['a 20 ms', LATE_WRITE],
    ['a 0 ms', NEXT_WRITE],
  ])('ends the loop at a no-listener entry throw with %s timer queued', async (_, write) => {
    const { fs, run } = fixture({
      '/project/fatal.cjs': `${write}\nthrow new Error('entry');`,
      '/project/ok.cjs': "console.log('next');",
    });

    // The next segment runs once the process is gone; its timer never does.
    const result = await run('node fatal.cjs ; echo next');
    expect(result).toMatchObject({ status: 'exited', exitCode: 0, stdout: 'next\n' });
    expect(result.requiresTermination).toBeUndefined();
    // Node's report: header at the throw, the user frame, the trailer.
    expect(result.stderr).toBe(
      "/project/fatal.cjs:2\nthrow new Error('entry');\n^\n\nError: entry\n    at Object.<anonymous> (/project/fatal.cjs:2:7)\n\nNode.js v24.0.0\n",
    );
    await run('sleep 0.05');
    expect(fs.existsSync('/project/late.txt')).toBe(false);
    expect(await run('node ok.cjs')).toMatchObject({ exitCode: 0, stdout: 'next\n' });
  });

  it.each([
    ['an entry', 'node fatal.cjs'],
    [
      'an eval',
      `node -e "Promise.resolve().then(() => { process.exitCode = 5; }); throw new Error('entry')"`,
    ],
  ])('keeps the fatal status of %s throw from a microtask queued before it', async (_, line) => {
    const { run } = fixture({
      '/project/fatal.cjs':
        "Promise.resolve().then(() => { process.exitCode = 5; });\nthrow new Error('entry');",
    });

    expect(await run(line)).toMatchObject({ status: 'exited', exitCode: 1 });
  });

  it("keeps an 'exit' listener's exitCode over a microtask queued before the throw", async () => {
    const { run } = fixture({
      '/project/fatal.cjs': `process.on('exit', () => { process.exitCode = 9; });
Promise.resolve().then(() => { process.exitCode = 6; });
throw new Error('entry');`,
    });

    expect(await run('node fatal.cjs')).toMatchObject({ status: 'exited', exitCode: 9 });
  });

  it('takes the status a write from the report itself leaves, as Node reads it after printing', async () => {
    const { run } = fixture({
      '/project/fatal.cjs': `Promise.resolve().then(() => { process.exitCode = 6; });
const e = new Error('entry');
Object.defineProperty(e, 'stack', { get() { process.exitCode = 5; return 'Error: entry'; } });
throw e;`,
    });

    expect(await run('node fatal.cjs')).toMatchObject({ status: 'exited', exitCode: 5 });
  });

  it.each([
    ['silenced', '() => true'],
    ['throwing', "() => { throw new Error('write'); }"],
  ])('prints the fatal report to the invocation stderr past a %s guest write', async (_, write) => {
    const { run } = fixture({
      '/project/fatal.cjs': `process.stderr.write = ${write};\nthrow new Error('entry');`,
    });

    const result = await run('node fatal.cjs');
    expect(result).toMatchObject({ status: 'exited', exitCode: 1 });
    expect(result.stderr).toMatch(/^\/project\/fatal\.cjs:2\n[\s\S]*\n\nError: entry\n {4}at /u);
  });

  it('ends a no-listener entry throw with the exitCode its exit listener sets', async () => {
    const { run } = fixture({
      '/project/fatal.cjs':
        "process.on('exit', () => { process.exitCode = 5; });\nthrow new Error('entry');",
    });

    expect(await run('node fatal.cjs')).toMatchObject({ status: 'exited', exitCode: 5 });
  });

  it('names a declared gap behind a no-listener entry throw, as behind a fatal rejection', async () => {
    const { run } = fixture({
      '/project/gap.cjs': "require('node:zlib').inflateRawSync(Buffer.from([1]));",
    });

    const result = await run('node gap.cjs');
    expect(result).toMatchObject({
      status: 'failed',
      exitCode: null,
      requiresTermination: true,
      error: { name: 'NotImplementedError', feature: 'zlib.inflateRawSync' },
    });
    expect(result.stderr).toMatch(/^NotImplementedError: Not implemented: zlib\.inflateRawSync /u);
    expect(result.stderr).toMatch(/\n {4}at \S+ \(\/project\/gap\.cjs:\d+:\d+\)(?: \{)?\n/u);
  });
});
