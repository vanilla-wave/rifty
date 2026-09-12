/// <reference lib="webworker" />

declare const self: DedicatedWorkerGlobalScope;

const NativeMemory = WebAssembly.Memory;
const nativePrototype = NativeMemory.prototype;

self.addEventListener(
  'message',
  async (event: MessageEvent<{ readonly toolchainWorkerUrl: string }>) => {
    await import(/* @vite-ignore */ event.data.toolchainWorkerUrl);
    const memory = new WebAssembly.Memory({ initial: 1 });
    self.postMessage({
      type: 'memory-identity',
      globalConstructorUnchanged: WebAssembly.Memory === NativeMemory,
      instanceConstructorUnchanged: memory.constructor === NativeMemory,
      prototypeUnchanged: Object.getPrototypeOf(memory) === nativePrototype,
      bytes: memory.buffer.byteLength,
    });
  },
  { once: true },
);
