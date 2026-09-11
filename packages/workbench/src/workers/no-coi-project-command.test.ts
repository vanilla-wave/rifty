import { riftyProcess } from '@riftydev/runtime-js/builtins/process';
import { clearTimeout, setTimeout } from '@riftydev/runtime-js/builtins/timers';
import type { ToolchainCommandInput } from '@riftydev/runtime-js/internal';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { runNoCoiProjectCommand } from './no-coi-project-command.ts';

const nativeProcess = Object.getOwnPropertyDescriptor(globalThis, 'process');
const decoder = new TextDecoder();

afterEach(() => {
  if (nativeProcess) Object.defineProperty(globalThis, 'process', nativeProcess);
  resetSyncMirror();
});

function fixture(files: Record<string, string> = {}) {
  const fs = new MemoryFsSync();
  fs.mkdirSync('/project/sub', { recursive: true });
  fs.loadFixture(files);
  setSyncMirror(fs);
  Object.defineProperty(globalThis, 'process', { configurable: true, value: riftyProcess });
  const run = async (
    command: string,
    options: Partial<ToolchainCommandInput> = {},
    signal = new AbortController().signal,
  ) => {
    let stdout = '';
    let stderr = '';
    const result = await runNoCoiProjectCommand(
      {
        project: { root: '/project' },
        command,
        cwd: '/project',
        env: {},
        ...options,
      },
      signal,
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

describe('no-COI invocation command', () => {
  it.each(['on', 'once', 'prependListener', 'prependOnceListener'])(
    'retires process %s callbacks before a later command Stop',
    async (method) => {
      const before = riftyProcess.rawListeners('SIGINT');
      const { fs, run } = fixture({
        '/project/first.cjs': `process.${method}('SIGINT', () => {
          process.stdout.write('OLD-OUTPUT');
          require('node:fs').writeFileSync('/project/old-effect', 'old');
        }); console.log('first-done');`,
        '/project/second.cjs': "process.stdout.write('second-entered'); setTimeout(() => {}, 20);",
      });
      try {
        expect((await run('node first.cjs')).stdout).toBe('first-done\n');
        const controller = new AbortController();
        let output = '';
        const result = await runNoCoiProjectCommand(
          {
            project: { root: '/project' },
            command: 'node second.cjs',
            cwd: '/project',
            env: {},
          },
          controller.signal,
          {
            fs,
            flush: async () => 'memory',
            effects: () => 'unknown',
            onOutput(chunk) {
              output += chunk;
              if (chunk === 'second-entered') controller.abort();
            },
          },
        );
        expect(result.status).toBe('cancelled');
        expect(output).toBe('second-entered');
        expect(fs.existsSync('/project/old-effect')).toBe(false);
      } finally {
        riftyProcess.removeAllListeners('SIGINT');
        for (const listener of before) riftyProcess.on('SIGINT', listener);
      }
    },
  );

  it('retires guest stdio listeners without replaying process meta-events', async () => {
    const { fs, run } = fixture({
      '/project/first.cjs': `
        for (const stream of [process.stdin, process.stdout, process.stderr])
          stream.once('test-event', () => require('node:fs').writeFileSync('/project/old-stream', 'old'));
        process.on('removeListener', () => require('node:fs').writeFileSync('/project/meta', 'old'));
        process.on('unused', () => {});
      `,
      '/project/second.cjs': `
        for (const stream of [process.stdin, process.stdout, process.stderr]) stream.emit('test-event');
      `,
    });
    try {
      expect((await run('node first.cjs')).exitCode).toBe(0);
      expect(fs.existsSync('/project/meta')).toBe(false);
      expect((await run('node second.cjs')).exitCode).toBe(0);
      expect(fs.existsSync('/project/old-stream')).toBe(false);
    } finally {
      riftyProcess.removeAllListeners('removeListener');
      riftyProcess.removeAllListeners('unused');
      for (const stream of [riftyProcess.stdin, riftyProcess.stdout, riftyProcess.stderr])
        stream.removeAllListeners('test-event');
    }
  });

  it.each([
    ['setTimeout', ''],
    ['setInterval', ''],
    ['setTimeout', "throw new Error('entry failed')"],
  ])('does not let unref %s effects escape after entry %s', async (timerMethod, ending) => {
    const { fs, run } = fixture({
      '/project/unref.cjs': `
        const timers = require('node:timers');
        const timer = timers.${timerMethod}(() => {
          timers.clearInterval(timer);
          require('node:fs').writeFileSync('/project/escaped.txt', 'late');
        }, 20).unref();
        ${ending}
      `,
    });
    expect(await run('node unref.cjs')).toMatchObject({
      status: 'exited',
      exitCode: ending === '' ? 0 : 1,
    });
    expect(fs.existsSync('/project/escaped.txt')).toBe(false);
    await run('sleep 0.05');
    expect(fs.existsSync('/project/escaped.txt')).toBe(false);
  });

  it('preserves unref timers belonging to the realm before the invocation', async () => {
    const { run } = fixture({ '/project/empty.cjs': '' });
    let fired = false;
    const timer = setTimeout(() => {
      fired = true;
    }, 20).unref();
    try {
      expect(await run('node empty.cjs')).toMatchObject({ status: 'exited', exitCode: 0 });
      await run('sleep 0.05');
      expect(fired).toBe(true);
    } finally {
      clearTimeout(timer);
    }
  });

  it('does not turn an undefined thrown value or flush rejection into success', async () => {
    const { fs, run } = fixture({ '/project/undefined.cjs': 'throw undefined' });
    expect((await run('node undefined.cjs')).exitCode).not.toBe(0);
    const result = await runNoCoiProjectCommand(
      {
        project: { root: '/project' },
        command: 'echo ok',
        cwd: '/project',
        env: {},
      },
      new AbortController().signal,
      {
        fs,
        onOutput() {},
        effects: () => 'yes',
        flush: () => Promise.reject(undefined),
      },
    );
    expect(result).toMatchObject({
      status: 'failed',
      effects: { persistence: 'failed' },
      error: { name: 'Error' },
    });
  });

  it('keeps process.exit and ordinary exitCode local to their real Node entry', async () => {
    const { run } = fixture({
      '/project/exit.cjs': 'process.exit(7)',
      '/project/code.cjs': 'process.exitCode = 9',
    });
    expect(await run('node exit.cjs')).toMatchObject({ status: 'exited', exitCode: 7 });
    expect(await run('node code.cjs')).toMatchObject({ status: 'exited', exitCode: 9 });
    expect(await run('node -p "1 + 2"')).toMatchObject({
      status: 'exited',
      exitCode: 0,
      stdout: '3\n',
    });
  });

  it('runs real Node entries through pipe/redirect contexts and restores invocation state', async () => {
    const { fs, run } = fixture({
      '/project/sub/output.cjs': `
        console.log(process.cwd(), process.env.VALUE);
        process.stdout.write('bytes');
        process.stderr.write('diagnostic');
        process.chdir('/project');
        process.env.VALUE = 'changed';
        process.exitCode = 7;
      `,
    });
    const previousCwd = riftyProcess.cwd();
    const previousEnv = riftyProcess.env;
    const previousArgv = riftyProcess.argv;
    const first = await run('cd sub && node output.cjs | cat > saved.txt', {
      env: { VALUE: 'first' },
    });
    expect(first).toMatchObject({
      status: 'exited',
      exitCode: 0,
      stdout: '',
      stderr: 'diagnostic',
    });
    expect(decoder.decode(fs.readFileBytesSync('/project/sub/saved.txt'))).toBe(
      '/project/sub first\nbytes',
    );
    expect(riftyProcess.cwd()).toBe(previousCwd);
    expect(riftyProcess.env).toBe(previousEnv);
    expect(riftyProcess.argv).toBe(previousArgv);
    expect(await run('pwd && echo "$VALUE"')).toMatchObject({
      stdout: '/project\n\n',
      exitCode: 0,
    });
    expect(await run('node -p "process.cwd()"')).toMatchObject({
      stdout: '/project\n',
      exitCode: 0,
    });
    expect(await run('node -p "1 + 1"')).toMatchObject({ stdout: '2\n', exitCode: 0 });
  });

  it('keeps delayed effects/output with a throwing Node handler before running the next segment', async () => {
    const { fs, run } = fixture({
      '/project/fail.cjs': `
        require('node:timers').setTimeout(() => {
          require('node:fs').writeFileSync('/project/late.txt', 'retained');
          process.stdout.write('late');
        }, 20);
        throw new Error('entry failed');
      `,
    });
    const result = await run('node fail.cjs ; echo next');
    expect(result).toMatchObject({ status: 'exited', exitCode: 0, stdout: 'latenext\n' });
    expect(result.stderr).toContain('entry failed');
    expect(decoder.decode(fs.readFileBytesSync('/project/late.txt'))).toBe('retained');
    expect(await run('echo separate')).toMatchObject({
      stdout: 'separate\n',
      stderr: '',
      exitCode: 0,
    });
  });

  it('reuses npm lifecycle, prefix and forwarded arguments with an actual bin loader', async () => {
    const { fs, run } = fixture({
      '/project/package.json': JSON.stringify({
        scripts: {
          prebuild: 'echo pre',
          build: 'cli',
          postbuild: 'echo post',
        },
      }),
      '/project/node_modules/.bin/cli': "#!/usr/bin/env node\nimport('../tool/cli.cjs')",
      '/project/node_modules/tool/package.json': '{"name":"tool"}',
      '/project/node_modules/tool/cli.cjs': 'console.log(JSON.stringify(process.argv.slice(2)))',
    });
    expect(await run("npm run build -- 'two words'", { cwd: '/project/sub' })).toMatchObject({
      exitCode: 0,
      stdout: '> echo pre\npre\n> cli \'two words\'\n["two words"]\n> echo post\npost\n',
    });
    const denied = await run('npm --prefix /project run build', {
      project: { root: '/project', allowedCommands: ['npm'] },
    });
    expect(denied.exitCode).toBe(1);
    expect(denied.stderr).toContain('Command is prohibited: echo');
    fs.writeFileSync(
      '/project/package.json',
      new TextEncoder().encode('{"scripts":{"build":"touch escaped &"}}'),
    );
    expect((await run('npm run build')).exitCode).toBe(1);
    expect(fs.existsSync('/project/escaped')).toBe(false);
  });

  it('keeps Stop pending through delayed Node handler effects and final flush', async () => {
    const { fs } = fixture({
      '/project/slow.cjs': `
        process.stdout.write('entered');
        require('node:timers').setTimeout(() => {
          require('node:fs').writeFileSync('/project/late.txt', 'retained');
          process.stdout.write('late');
        }, 20);
      `,
    });
    const controller = new AbortController();
    const events: string[] = [];
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let flushed!: () => void;
    const atFlush = new Promise<void>((resolve) => {
      flushed = resolve;
    });
    const completion = runNoCoiProjectCommand(
      {
        project: { root: '/project' },
        command: 'node slow.cjs',
        cwd: '/project',
        env: {},
      },
      controller.signal,
      {
        fs,
        effects: () => 'yes',
        onOutput(chunk) {
          events.push(chunk);
          if (chunk === 'entered') controller.abort();
        },
        async flush() {
          flushed();
          await barrier;
          return 'memory';
        },
      },
    );
    let settled = false;
    void completion.then(() => {
      settled = true;
    });
    await atFlush;
    expect(events).toEqual(['entered', 'late']);
    expect(decoder.decode(fs.readFileBytesSync('/project/late.txt'))).toBe('retained');
    expect(settled).toBe(false);
    release();
    expect(await completion).toMatchObject({
      status: 'cancelled',
      exitCode: 130,
      effects: { applied: 'yes', persistence: 'memory' },
    });
  });
});
