import type { SandboxSupportCheckId, SupportWorkerMessage, SupportWorkerRequest } from './types.ts';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const emit = (message: SupportWorkerMessage): void => scope.postMessage(message);

async function probe(id: SandboxSupportCheckId, operation: () => unknown | Promise<unknown>) {
  try {
    await operation();
    emit({
      kind: 'check',
      check: {
        id,
        status: 'passed',
        reason: `${id}: native operation succeeded in dedicated Worker`,
      },
    });
  } catch (error) {
    const detail =
      error instanceof Error || error instanceof DOMException
        ? { name: error.name, message: error.message }
        : { name: 'Error', message: String(error) };
    emit({
      kind: 'check',
      check: {
        id,
        status: 'failed',
        reason: `${id}: ${detail.name}: ${detail.message || 'cause unknown'}`,
        error: detail,
      },
    });
  }
}

scope.onmessage = (event: MessageEvent<SupportWorkerRequest>) => {
  const request = event.data;
  if (request.kind === 'storage') {
    void probe('opfs', () => storage(request.directory, request.name));
    return;
  }
  if (request.kind !== 'start') return;
  emit({
    kind: 'check',
    check: {
      id: 'module-worker',
      status: 'passed',
      reason: 'Module Worker loaded and received structured input',
    },
  });
  request.port.onmessage = (event) => request.port.postMessage(event.data, [event.data.bytes]);
  try {
    const channel = new BroadcastChannel(request.name);
    channel.onmessage = (event) => {
      if (event.data === request.name) channel.postMessage(`${request.name}:reply`);
    };
    // Native channel readiness travels over that channel, not only MessagePort.
    channel.postMessage(`${request.name}:ready`);
  } catch (error) {
    void probe('broadcast-channel', () => {
      throw error;
    });
  }
  const asset = (name: string) => {
    const url = new URL(name, import.meta.url);
    url.search = scope.location.search;
    return url.href;
  };
  void Promise.all([
    probe('module-import', async () => {
      const module = await import(/* @vite-ignore */ asset('support-module.js'));
      if (module.supportValue !== 42) throw new Error('Unexpected imported value');
    }),
    probe(
      'nested-worker',
      () =>
        new Promise<void>((resolve, reject) => {
          const child = new Worker(asset('support-child.js'), { type: 'module' });
          child.onmessage = (event) => {
            child.terminate();
            if (event.data === 42) resolve();
            else reject(new Error('Unexpected nested Worker response'));
          };
          child.onerror = (event) => {
            event.preventDefault();
            child.terminate();
            reject(new Error(event.message || 'Nested Worker failed; cause unknown'));
          };
        }),
    ),
    probe('js-eval', () => {
      // biome-ignore lint/security/noGlobalEval: Probe the indirect eval used by the actual COI kernel importer.
      const evaluate = eval;
      if (new Function('return 21 * 2')() !== 42 || evaluate('21 * 2') !== 42) {
        throw new Error('Unexpected JS evaluation result');
      }
    }),
    probe('wasm', async () => {
      const module = await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
      await WebAssembly.instantiate(module);
    }),
    ...(request.memory === undefined
      ? []
      : [
          probe('shared-memory', async () => {
            const view = new Int32Array(request.memory!);
            Atomics.store(view, 0, 42);
            if (Atomics.wait(view, 0, 42, 0) !== 'timed-out')
              throw new Error('Unexpected Atomics.wait result');
            Atomics.notify(view, 0);
            const atomics = Atomics as unknown as {
              waitAsync(
                view: Int32Array,
                index: number,
                value: number,
                timeout: number,
              ): { value: string | Promise<string> };
            };
            if ((await atomics.waitAsync(view, 0, 42, 0).value) !== 'timed-out')
              throw new Error('Unexpected Atomics.waitAsync result');
          }),
        ]),
  ]).then(() => emit({ kind: 'done' }));
};

async function storage(directory: FileSystemDirectoryHandle, name: string): Promise<void> {
  const nativeRoot = await navigator.storage.getDirectory();
  const nativeDirectory = await nativeRoot.getDirectoryHandle(name);
  if (!(await nativeDirectory.isSameEntry(directory)))
    throw new Error('Worker storage belongs to a different origin');
  const bytes = new Uint8Array([0, 37, 128, 255]);
  const guardFile = await directory.getFileHandle('guard', { create: true });
  const guard = await guardFile.createSyncAccessHandle();
  try {
    guard.write(bytes, { at: 0 });
    guard.flush();
    const read = new Uint8Array(bytes.length);
    if (
      guard.read(read, { at: 0 }) !== bytes.length ||
      !bytes.every((byte, i) => read[i] === byte)
    ) {
      throw new Error('OPFS sync readback differed');
    }
    const file = await directory.getFileHandle('replica', { create: true });
    const writer = await file.createWritable();
    try {
      await writer.write(bytes);
      await writer.close();
    } catch (error) {
      await writer.abort().catch(() => {});
      throw error;
    }
    const actual = new Uint8Array(await (await file.getFile()).arrayBuffer());
    if (actual.length !== bytes.length || !bytes.every((byte, i) => actual[i] === byte)) {
      throw new Error('OPFS replica readback differed');
    }
    const digest = await crypto.subtle.digest('SHA-256', actual);
    if (digest.byteLength !== 32) throw new Error('OPFS replica digest failed');
    await directory.removeEntry('replica');
  } finally {
    guard.close();
  }
  await directory.removeEntry('guard');
}
