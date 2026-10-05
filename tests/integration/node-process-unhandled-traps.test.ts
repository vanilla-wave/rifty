import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { createHostMessageChannel } from '../../packages/io/src/index.ts';
import { runEntryLifecycle } from '../../packages/kernel/src/worker-entry.ts';
import { runNodeEntry } from '../../packages/runtime-js/src/builtins/node-entry.ts';
import {
  readActiveNodeProcessBootstrap,
  setActiveNodeProcessBootstrap,
} from '../../packages/runtime-js/src/builtins/process-bootstrap-identity.ts';
import { NodeProcess } from '../../packages/runtime-js/src/builtins/process.ts';
import {
  awaitDrain,
  installUnhandledErrorTrap,
  installUnhandledRejectionTrap,
  ref,
  resetKeepalive,
  unref,
} from '../../packages/runtime-js/src/internal/event-loop-keepalive.ts';
import {
  MemoryFsSync,
  resetSyncMirror,
  setSyncMirror,
} from '../../packages/vfs/src/internal/index.ts';
import {
  runNodeProgramLifecycle,
  runNodeProgramToCompletion,
} from '../../packages/workbench/src/workers/node-program-lifecycle.ts';

it.each([
  ['error', false, false, 'serve'],
  ['unhandledrejection', false, false, 'serve'],
  ['error', true, false, 'serve'],
  ['unhandledrejection', true, false, 'serve'],
  ['error', false, true, 'serve'],
  ['unhandledrejection', false, true, 'serve'],
  ['error', false, true, 'completion'],
  ['unhandledrejection', false, true, 'completion'],
] as const)(
  'owned %s handled=%s pending=%s mode=%s reaches Node exit before kernel teardown',
  async (kind, handled, pending, mode) => {
    const expectedCode = handled ? 0 : 1;
    const processEvent = kind === 'error' ? 'uncaughtException' : 'unhandledRejection';
    const handler = handled ? `process.on('${processEvent}', () => {});` : '';
    const nativeSource =
      kind === 'error'
        ? "setTimeout(() => { throw Error('boom') }, 0)"
        : "Promise.reject(Error('boom'))";
    const native = spawnSync(
      'node',
      [
        ...(pending ? ['--input-type=module'] : []),
        '-e',
        `process.once('exit', code => console.log('EXIT', code)); ${handler} ${nativeSource} ${pending ? ';await new Promise(() => {})' : ''}`,
      ],
      { encoding: 'utf8' },
    );
    expect(native.status).toBe(expectedCode);
    expect(native.stdout.trim()).toBe(`EXIT ${expectedCode}`);
    const channels = Array.from({ length: 4 }, () => createHostMessageChannel());
    const spec = {
      entry: { kind: 'source' as const, code: '', sourceUrl: 'test' },
      argv: ['rifty'],
      env: {},
      cwd: '/',
      stdio: {
        stdin: channels[0]!.port1,
        stdout: channels[1]!.port1,
        stderr: channels[2]!.port1,
        ipc: channels[3]!.port1,
      },
      syncRing: new SharedArrayBuffer(64),
      pid: 2,
      ppid: 1,
      serve: true,
    };
    const proc = new NodeProcess(spec);
    if (handled) proc.on(processEvent, () => {});
    const previous = readActiveNodeProcessBootstrap();
    setActiveNodeProcessBootstrap(proc);
    const exits: number[] = [];
    proc.once('exit', (code) => exits.push(code as number));
    const target = new EventTarget();
    // Real DOM dispatch; Node lacks browser ErrorEvent/PromiseRejectionEvent constructors.
    const event = new Event(kind, { cancelable: true });
    Object.defineProperty(event, kind === 'error' ? 'error' : 'reason', {
      value: new Error('boom'),
    });
    if (kind === 'error') installUnhandledErrorTrap(target);
    else installUnhandledRejectionTrap(target);
    const diagnostics: string[] = [];
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/pending.mjs':
        'await new Promise(resolve => { globalThis.__riftyPendingEntryRelease = resolve; });',
    });
    setSyncMirror(vfs);
    const deadline = { timer: undefined as ReturnType<typeof setTimeout> | undefined };
    const deps = {
      runEntry: async () => {
        ref();
        setTimeout(() => {
          target.dispatchEvent(event);
          unref();
        }, 0);
        if (pending) await runNodeEntry({ vfs, entryPath: '/pending.mjs', cwd: '/' });
      },
      awaitDrain: (hasPendingEntry?: () => boolean) =>
        awaitDrain({ hasRef: () => hasPendingEntry?.() ?? false }),
      readExitCode: () => proc.exitCode,
      exit: proc.exit.bind(proc),
      writeStderr: (chunk: string) => diagnostics.push(chunk),
    };
    try {
      const lifecycle = runEntryLifecycle(spec, {
        preEntryHook: null,
        drainHook: null,
        writeStderr: (bytes) => diagnostics.push(new TextDecoder().decode(bytes)),
        runEntry: () =>
          mode === 'completion'
            ? runNodeProgramToCompletion(deps)
            : runNodeProgramLifecycle({
                ...deps,
                listPorts: () => [],
                onPortsChange: () => () => {},
                servePreview: () => () => {},
                postListening: () => {},
              }),
      });
      const outcome = await Promise.race([
        lifecycle,
        new Promise<never>((_, reject) => {
          deadline.timer = setTimeout(
            () => reject(new Error('owned fatal error left real ESM entry pending')),
            500,
          );
        }),
      ]);
      expect(outcome.code).toBe(expectedCode);
      expect(exits).toEqual([expectedCode]);
      expect(event.defaultPrevented).toBe(true);
      if (handled) expect(diagnostics).toEqual([]);
      else expect(diagnostics.join('')).toContain('boom');
    } finally {
      setActiveNodeProcessBootstrap(previous?.process ?? null, previous?.federated);
      for (const channel of channels) {
        channel.port1.close();
        channel.port2.close();
      }
      resetKeepalive();
      if (deadline.timer) clearTimeout(deadline.timer);
      const release = Reflect.get(globalThis, '__riftyPendingEntryRelease');
      if (typeof release === 'function') release();
      Reflect.deleteProperty(globalThis, '__riftyPendingEntryRelease');
      resetSyncMirror();
    }
  },
  1500,
);

it.each(['error', 'unhandledrejection'] as const)(
  'foreign %s retains browser default reporting',
  (kind) => {
    const previous = readActiveNodeProcessBootstrap();
    setActiveNodeProcessBootstrap(null);
    try {
      const target = new EventTarget();
      const event = new Event(kind, { cancelable: true });
      Object.defineProperty(event, kind === 'error' ? 'error' : 'reason', {
        value: new Error('foreign'),
      });
      if (kind === 'error') installUnhandledErrorTrap(target);
      else installUnhandledRejectionTrap(target);
      target.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    } finally {
      setActiveNodeProcessBootstrap(previous?.process ?? null, previous?.federated);
      resetKeepalive();
    }
  },
);
