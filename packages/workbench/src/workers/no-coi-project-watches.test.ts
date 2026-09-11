import { unwatchFile, watchFile } from '@riftydev/runtime-js/builtins/fs-watch';
import { riftyProcess } from '@riftydev/runtime-js/builtins/process';
import { clearInterval, setInterval } from '@riftydev/runtime-js/builtins/timers';
import { captureTimerBoundary, clearTimersSince } from '@riftydev/runtime-js/internal';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { runNoCoiProjectCommand } from './no-coi-project-command.ts';

const nativeProcess = Object.getOwnPropertyDescriptor(globalThis, 'process');
const nativeSetInterval = globalThis.setInterval;
const nativeClearInterval = globalThis.clearInterval;
const encoder = new TextEncoder();
let boundary = 0;

afterEach(() => {
  unwatchFile('/project/watched');
  unwatchFile('/project/older');
  clearTimersSince(boundary);
  globalThis.setInterval = nativeSetInterval;
  globalThis.clearInterval = nativeClearInterval;
  Reflect.deleteProperty(globalThis, '__riftyRetiredWatchAbort');
  Reflect.deleteProperty(globalThis, '__riftyRetiredPromiseAbort');
  if (nativeProcess) Object.defineProperty(globalThis, 'process', nativeProcess);
  resetSyncMirror();
});

function fixture(files: Record<string, string> = {}) {
  boundary = captureTimerBoundary();
  const fs = new MemoryFsSync();
  fs.loadFixture({ '/project/watched': 'first', '/project/older': 'first', ...files });
  setSyncMirror(fs);
  globalThis.setInterval = setInterval as unknown as typeof globalThis.setInterval;
  globalThis.clearInterval = clearInterval as typeof globalThis.clearInterval;
  Object.defineProperty(globalThis, 'process', { configurable: true, value: riftyProcess });
  const run = async (command: string) => {
    let stdout = '';
    let stderr = '';
    const result = await runNoCoiProjectCommand(
      { project: { root: '/project' }, command, cwd: '/project', env: {} },
      new AbortController().signal,
      {
        fs,
        effects: () => 'unknown',
        flush: async () => 'memory',
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

describe('no-COI command watcher retirement', () => {
  it('starts a live watchFile poller on the same path after the prior command exits', async () => {
    const { fs, run } = fixture({
      '/project/first.cjs': `
        const fs = require('node:fs');
        fs.watchFile('/project/watched', { interval: 2, persistent: false }, () => {
          fs.writeFileSync('/project/stale', 'old listener');
        });
      `,
      '/project/second.cjs': `
        const fs = require('node:fs');
        const timers = require('node:timers');
        fs.watchFile('/project/watched', { interval: 2, persistent: false }, () => {
          fs.writeFileSync('/project/fresh', 'new listener');
          fs.unwatchFile('/project/watched');
        });
        timers.setTimeout(() => fs.writeFileSync('/project/watched', 'second'), 10);
        timers.setTimeout(() => fs.unwatchFile('/project/watched'), 40);
      `,
    });
    expect(await run('node first.cjs')).toMatchObject({ status: 'exited', exitCode: 0 });
    expect(await run('node second.cjs')).toMatchObject({ status: 'exited', exitCode: 0 });
    expect(fs.existsSync('/project/stale')).toBe(false);
    expect(fs.existsSync('/project/fresh')).toBe(true);
  });

  it('silently retires FSWatcher abort and event callbacks before the next command', async () => {
    const { fs, run } = fixture({
      '/project/watch.cjs': `
        const fs = require('node:fs');
        const abort = new AbortController();
        globalThis.__riftyRetiredWatchAbort = abort;
        const watcher = fs.watch('/project/watched', {
          interval: 2, persistent: false, signal: abort.signal
        });
        watcher.on('close', () => fs.writeFileSync('/project/old-close', 'closed'));
        watcher.on('change', () => fs.writeFileSync('/project/old-change', 'changed'));
        watcher.on('removeListener', () => fs.writeFileSync('/project/old-remove', 'removed'));
      `,
      '/project/abort.cjs': `
        globalThis.__riftyRetiredWatchAbort.abort();
        require('node:fs').writeFileSync('/project/watched', 'next');
        require('node:timers').setTimeout(() => {}, 15);
      `,
    });
    expect(await run('node watch.cjs')).toMatchObject({ status: 'exited', exitCode: 0 });
    expect(await run('node abort.cjs')).toMatchObject({ status: 'exited', exitCode: 0 });
    for (const file of ['old-close', 'old-change', 'old-remove']) {
      expect(fs.existsSync(`/project/${file}`), file).toBe(false);
    }
  });

  it('keeps ordinary explicit watcher.close asynchronous and observable exactly once', async () => {
    const { run } = fixture({
      '/project/close.cjs': `
        const fs = require('node:fs');
        const abort = new AbortController();
        const watcher = fs.watch('/project/watched', { signal: abort.signal });
        watcher.on('close', () => process.stdout.write('close;'));
        watcher.close();
        watcher.close();
        process.stdout.write('after-close;');
        abort.abort();
      `,
    });
    expect(await run('node close.cjs')).toMatchObject({
      status: 'exited',
      exitCode: 0,
      stdout: 'after-close;close;',
    });
  });

  it('detaches the abort rejection of a retired unref timer promise', async () => {
    const { fs, run } = fixture({
      '/project/promise.cjs': `
        const abort = new AbortController();
        globalThis.__riftyRetiredPromiseAbort = abort;
        require('node:timers/promises').setTimeout(10000, undefined, {
          ref: false, signal: abort.signal
        }).catch(() => require('node:fs').writeFileSync('/project/old-rejection', 'late'));
      `,
      '/project/abort-promise.cjs': `
        globalThis.__riftyRetiredPromiseAbort.abort();
        require('node:timers').setTimeout(() => {}, 10);
      `,
    });
    expect(await run('node promise.cjs')).toMatchObject({ status: 'exited', exitCode: 0 });
    expect(await run('node abort-promise.cjs')).toMatchObject({ status: 'exited', exitCode: 0 });
    expect(fs.existsSync('/project/old-rejection')).toBe(false);
  });

  it.each([false, true])(
    'preserves a pre-scope poller when command shares its path: %s',
    async (shared) => {
      const path = shared ? '/project/watched' : '/project/older';
      const { fs, run } = fixture({
        '/project/attach.cjs': `
        const fs = require('node:fs');
        fs.watchFile('/project/watched', { interval: 2, persistent: false }, () => {
          fs.writeFileSync('/project/stale', 'retired');
        });
      `,
        '/project/change.cjs': `
        require('node:fs').writeFileSync('${path}', 'changed');
        require('node:timers').setTimeout(() => {}, 20);
      `,
      });
      let hostChanges = 0;
      watchFile(path, { interval: 2, persistent: false }, () => {
        hostChanges += 1;
      });
      expect(await run('node attach.cjs')).toMatchObject({ status: 'exited', exitCode: 0 });
      expect(await run('node change.cjs')).toMatchObject({ status: 'exited', exitCode: 0 });
      expect(hostChanges).toBe(1);
      expect(fs.existsSync('/project/stale')).toBe(false);
      fs.writeFileSync(path, encoder.encode('still-live'));
      await run('sleep 0.02');
      expect(hostChanges).toBe(2);
    },
  );
});
