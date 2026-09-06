import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnToolchainRuntime } from './host.ts';
import {
  SANDBOX_TOOLCHAIN_PROTOCOL,
  type ToolchainActivationState,
  type ToolchainHostMessage,
  type ToolchainWorkerMessage,
} from './protocol.ts';

// Only the unavailable browser Worker boundary is replaced; the host is real.
class Peer {
  static latest: Peer;
  readonly sent: ToolchainHostMessage[] = [];
  private receive?: (event: MessageEvent<ToolchainWorkerMessage>) => void;
  constructor() {
    Peer.latest = this;
  }
  addEventListener(type: string, listener: (event: MessageEvent<ToolchainWorkerMessage>) => void) {
    if (type === 'message') this.receive = listener;
  }
  postMessage(message: ToolchainHostMessage) {
    this.sent.push(structuredClone(message));
  }
  terminate() {}
  emit(data: ToolchainWorkerMessage) {
    this.receive?.({ data } as MessageEvent<ToolchainWorkerMessage>);
  }
  finishRestore() {
    const message = this.sent.at(-1);
    if (message?.type !== 'toolchain' || message.request.op !== 'restore') {
      throw new Error('Expected restore request');
    }
    this.emit({ type: 'toolchain-result', result: { id: message.request.id, ok: true } });
    return message.request.input;
  }
}

function activation(vfsBackend: 'opfs' | 'memory'): ToolchainActivationState {
  return {
    cwd: '/dev',
    bindings: [],
    vfsBackend,
    files: [
      { path: '/dev/package.json', data: new Uint8Array([1, 2]) },
      { path: '/outside.bin', data: new Uint8Array(1024).fill(7) },
    ],
  };
}

async function boot(backend: 'opfs' | 'memory') {
  vi.stubGlobal('Worker', Peer);
  const runtime = spawnToolchainRuntime({ workerUrl: '/toolchain.js' });
  const peer = Peer.latest;
  peer.emit({ type: 'ready' });
  peer.emit({ type: 'toolchain-ready', protocol: SANDBOX_TOOLCHAIN_PROTOCOL, vfsBackend: backend });
  await runtime.toolchainReady;
  return { runtime, peer };
}

async function restore(
  runtime: ReturnType<typeof spawnToolchainRuntime>,
  peer: Peer,
  state: ToolchainActivationState,
) {
  const restoring = runtime.restoreToolchainState(state);
  await Promise.resolve();
  const sent = peer.finishRestore();
  await restoring;
  return sent;
}

function writeId(peer: Peer): number {
  const message = peer.sent.at(-1);
  if (message?.type !== 'fs' || message.request.op !== 'writeFile')
    throw new Error('Expected write');
  return message.request.id;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('no-COI recovery ownership', () => {
  it('copies only the written bytes after acknowledgement', async () => {
    const { runtime, peer } = await boot('memory');
    await restore(runtime, peer, activation('memory'));
    const NativeBytes = Uint8Array;
    let copied = 0;
    vi.stubGlobal(
      'Uint8Array',
      new Proxy(NativeBytes, {
        construct(target, args) {
          if (args[0] instanceof NativeBytes) copied += args[0].byteLength;
          return Reflect.construct(target, args);
        },
      }),
    );
    const nativeSlice = NativeBytes.prototype.slice;
    vi.spyOn(NativeBytes.prototype, 'slice').mockImplementation(function (
      this: Uint8Array,
      start,
      end,
    ) {
      const result = nativeSlice.call(this, start, end);
      copied += result.byteLength;
      return result;
    });
    const data = NativeBytes.of(8, 9, 10);
    const writing = runtime.fs.writeFile('/dev/package.json', data);
    peer.emit({ type: 'fs-result', result: { id: writeId(peer), ok: true } });
    await writing;
    expect(copied).toBe(data.byteLength);
    expect(runtime.snapshotToolchainState()?.files[0]?.data).toEqual(data);
    runtime.dispose();
  });

  it.each([
    ['opfs', 'opfs', false],
    ['opfs', 'memory', true],
    ['memory', 'opfs', true],
    ['memory', 'memory', true],
  ] as const)(
    'restores %s to %s with correct wire bytes and full retained state',
    async (source, target, carriesFiles) => {
      const state = activation(source);
      const { runtime, peer } = await boot(target);
      const sent = await restore(runtime, peer, state);
      expect(sent.files).toEqual(carriesFiles ? state.files : []);
      expect(runtime.snapshotToolchainState()).toEqual(state);
      // An optimized OPFS wire must not poison the next memory recovery.
      const replacement = await boot('memory');
      const retained = runtime.snapshotToolchainState();
      if (!retained) throw new Error('Lost activation');
      const recovered = await restore(replacement.runtime, replacement.peer, retained);
      expect(recovered.files).toEqual(state.files);
      runtime.dispose();
      replacement.runtime.dispose();
    },
  );

  it('keeps ordered acknowledged writes and detaches snapshots and pending input', async () => {
    const { runtime, peer } = await boot('memory');
    const state = activation('memory');
    await restore(runtime, peer, state);
    state.files[0]?.data.fill(99);
    const before = runtime.snapshotToolchainState();
    before?.files[0]?.data.fill(88);
    const firstData = new Uint8Array([3]);
    const first = runtime.fs.writeFile('/dev/package.json', firstData);
    const firstId = writeId(peer);
    firstData.fill(77);
    const second = runtime.fs.writeFile('/dev/package.json', new Uint8Array([4]));
    const secondId = writeId(peer);
    expect(runtime.snapshotToolchainState()?.files[0]?.data).toEqual(new Uint8Array([1, 2]));
    peer.emit({ type: 'fs-result', result: { id: firstId, ok: true } });
    await first;
    const between = runtime.snapshotToolchainState();
    expect(between?.files[0]?.data).toEqual(new Uint8Array([3]));
    peer.emit({ type: 'fs-result', result: { id: secondId, ok: true } });
    await second;
    expect(runtime.snapshotToolchainState()?.files[0]?.data).toEqual(new Uint8Array([4]));
    expect(between?.files[0]?.data).toEqual(new Uint8Array([3]));
    runtime.dispose();
  });

  it.each(['reject', 'death'] as const)(
    'retains acknowledged recovery after write %s',
    async (fault) => {
      const { runtime, peer } = await boot('memory');
      const state = activation('memory');
      await restore(runtime, peer, state);
      const writing = runtime.fs.writeFile('/dev/package.json', 'lost');
      const rejected = expect(writing).rejects.toBeInstanceOf(Error);
      if (fault === 'death') runtime.dispose();
      else
        peer.emit({
          type: 'fs-result',
          result: {
            id: writeId(peer),
            ok: false,
            error: { name: 'Error', message: 'quota', code: 'ENOSPC' },
          },
        });
      await rejected;
      expect(runtime.snapshotToolchainState()).toEqual(state);
      runtime.dispose();
    },
  );
});
