import { getKernelDrainHook, setKernelDrainHook } from '@riftydev/kernel';
import { expect, it } from 'vitest';
import {
  activeRefs,
  awaitDrain,
  installEventLoopKeepalive,
  resetKeepalive,
} from './event-loop-keepalive.ts';

it('holds native WASM compile/instantiate jobs until their returned promises settle', async () => {
  const compile = Object.getOwnPropertyDescriptor(WebAssembly, 'compile')!;
  const instantiate = Object.getOwnPropertyDescriptor(WebAssembly, 'instantiate')!;
  const self = Object.getOwnPropertyDescriptor(globalThis, 'self');
  const drain = getKernelDrainHook();
  Reflect.set(globalThis, 'self', new EventTarget());
  try {
    installEventLoopKeepalive();
    const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    const module = WebAssembly.compile(bytes);
    const instance = WebAssembly.instantiate(bytes);
    expect(activeRefs()).toBe(2);
    await Promise.all([module, instance]);
    expect(activeRefs()).toBe(0);
    await expect(WebAssembly.compile(new Uint8Array([0]))).rejects.toThrow();
    await expect(awaitDrain()).resolves.toBeUndefined();
  } finally {
    Object.defineProperty(WebAssembly, 'compile', compile);
    Object.defineProperty(WebAssembly, 'instantiate', instantiate);
    Reflect.deleteProperty(WebAssembly, Symbol.for('rifty.runtime-js.wasm-keepalive.v1'));
    if (self) Object.defineProperty(globalThis, 'self', self);
    else Reflect.deleteProperty(globalThis, 'self');
    setKernelDrainHook(drain);
    resetKeepalive();
  }
});
