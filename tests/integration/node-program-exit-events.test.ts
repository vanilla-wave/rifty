import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { createHostMessageChannel } from '../../packages/io/src/index.ts';
import { runEntryLifecycle } from '../../packages/kernel/src/worker-entry.ts';
import { runNodeEntry } from '../../packages/runtime-js/src/builtins/node-entry.ts';
import { NodeProcess } from '../../packages/runtime-js/src/builtins/process.ts';
import { resetKeepalive } from '../../packages/runtime-js/src/internal/event-loop-keepalive.ts';
import {
  activeRefs,
  awaitDrain,
  ref,
  unref,
} from '../../packages/runtime-js/src/internal/event-loop-keepalive.ts';
import {
  MemoryFsSync,
  resetSyncMirror,
  setSyncMirror,
} from '../../packages/vfs/src/internal/index.ts';
import { runNodeProgramLifecycle } from '../../packages/workbench/src/workers/node-program-lifecycle.ts';
import { runNodeProgramToCompletion } from '../../packages/workbench/src/workers/node-program-lifecycle.ts';

it.each([
  ['entry failure', "throw new Error('boom')", 1],
  ['natural wide code', 'process.exitCode = 300', 300],
  ['explicit wide code', 'process.exit(300)', 300],
  [
    'captured fatal exit',
    "process.exit = () => { throw Error('guest exit') }; throw Error('boom')",
    1,
  ],
  [
    'captured natural exit',
    "process.exit = () => { throw Error('guest exit') }; process.exitCode = 7",
    7,
  ],
  ['drain exit', 'process.exit(7)', 7],
  ['drain failure', "throw Error('boom')", 1],
  ['eval entry failure', "throw new Error('boom')", 1],
] as const)(
  '%s emits the raw exit code once before kernel status wrapping',
  async (_name, source, rawCode) => {
    const native = spawnSync(
      'node',
      ['-e', `process.once('exit', code => console.log('EXIT', code)); ${source}`],
      { encoding: 'utf8' },
    );
    expect(native.stdout.trim()).toBe(`EXIT ${rawCode}`);
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'process');
    const bindings = new Map(
      ['require', 'module', 'exports', '__filename', '__dirname'].map((key) => [
        key,
        Object.getOwnPropertyDescriptor(globalThis, key),
      ]),
    );
    const channels = Array.from({ length: 4 }, () => createHostMessageChannel());
    const stdio = {
      stdin: channels[0]!.port1,
      stdout: channels[1]!.port1,
      stderr: channels[2]!.port1,
      ipc: channels[3]!.port1,
    };
    const spec = {
      entry: { kind: 'source' as const, code: '', sourceUrl: 'test' },
      argv: ['rifty', '/work/entry.cjs'],
      env: {},
      cwd: '/work',
      stdio,
      syncRing: new SharedArrayBuffer(64),
      pid: 2,
      ppid: 1,
      serve: true,
    };
    const proc = new NodeProcess(spec);
    const exits: number[] = [];
    const diagnostics: string[] = [];
    proc.once('exit', (code) => exits.push(code as number));
    const exit = proc.exit.bind(proc);
    const vfs = new MemoryFsSync();
    vfs.loadFixture({ '/work/entry.cjs': source });
    setSyncMirror(vfs);
    Object.defineProperty(globalThis, 'process', { value: proc, configurable: true });
    try {
      const outcome = await runEntryLifecycle(spec, {
        preEntryHook: null,
        drainHook: null,
        writeStderr: (bytes) => diagnostics.push(new TextDecoder().decode(bytes)),
        runEntry: () =>
          runNodeProgramLifecycle({
            runEntry: () =>
              _name.startsWith('drain')
                ? Promise.resolve()
                : runNodeEntry(
                    _name.startsWith('eval')
                      ? {
                          kind: 'eval',
                          vfs,
                          cwd: '/work',
                          source,
                          print: false,
                          explicitCommonJs: false,
                        }
                      : { vfs, cwd: '/work', entryPath: '/work/entry.cjs' },
                  ),
            listPorts: () => [],
            onPortsChange: () => () => {},
            awaitDrain: async () => {
              if (_name === 'drain exit') exit(7);
              if (_name === 'drain failure') throw new Error('boom');
            },
            servePreview: () => () => {},
            postListening: () => {},
            readExitCode: () => proc.exitCode,
            exit,
            writeStderr: (chunk) => diagnostics.push(chunk),
          }),
      });
      expect(outcome.code).toBe(native.status);
      expect(exits).toEqual([rawCode]);
      if (rawCode === 1) expect(diagnostics.join('')).toContain('boom');
      else expect(diagnostics).toEqual([]);
    } finally {
      if (previous) Object.defineProperty(globalThis, 'process', previous);
      else Reflect.deleteProperty(globalThis, 'process');
      for (const [key, descriptor] of bindings) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      for (const channel of channels) {
        channel.port1.close();
        channel.port2.close();
      }
      resetKeepalive();
      resetSyncMirror();
    }
  },
);

it('run-to-completion waits for referenced work before its exit event', async () => {
  const native = spawnSync(
    'node',
    [
      '-e',
      "let fired = false; process.once('exit', () => console.log(fired)); setTimeout(() => { fired = true }, 10)",
    ],
    { encoding: 'utf8' },
  );
  expect(native.status).toBe(0);
  expect(native.stdout.trim()).toBe('true');
  const proc = new NodeProcess();
  let timerFired = false;
  let firedAtExit: boolean | undefined;
  proc.once('exit', () => {
    firedAtExit = timerFired;
  });
  let complete!: () => void;
  const timerDone = new Promise<void>((resolve) => {
    complete = resolve;
  });
  try {
    await expect(
      runNodeProgramToCompletion({
        runEntry: async () => {
          ref();
          setTimeout(() => {
            timerFired = true;
            unref();
            complete();
          }, 10);
        },
        awaitDrain: (hasPendingEntry) => awaitDrain({ hasRef: () => hasPendingEntry?.() ?? false }),
        readExitCode: () => proc.exitCode,
        exit: proc.exit.bind(proc),
        writeStderr: () => {},
      }),
    ).rejects.toMatchObject({ code: 'RIFTY_PROCESS_EXIT', exitCode: 0 });
    expect(firedAtExit).toBe(true);
    expect(activeRefs()).toBe(0);
  } finally {
    await timerDone;
    resetKeepalive();
  }
});
