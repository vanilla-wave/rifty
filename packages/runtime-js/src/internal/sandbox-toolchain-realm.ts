import { NotImplementedError } from '@riftydev/io';

const SANDBOX_TOOLCHAIN_REALM = Symbol.for('rifty.runtime-js.sandbox-toolchain.v1');

/** True only when the selected Workbench toolchain Worker claimed this realm. */
export function isSandboxToolchainRealm(): boolean {
  return Reflect.get(globalThis, SANDBOX_TOOLCHAIN_REALM) === true;
}

/** Guest lexical WebAssembly binding; the Worker global stays native and identity-stable. */
export function sandboxToolchainWebAssembly(): typeof WebAssembly {
  if (!isSandboxToolchainRealm()) return WebAssembly;
  const NativeMemory = WebAssembly.Memory;
  const memoryHandler: ProxyHandler<typeof NativeMemory> = {
    construct(target, args, newTarget) {
      const descriptor = args[0];
      const descriptorType = typeof descriptor;
      let effectiveArgs = args;
      if (descriptor !== null && (descriptorType === 'object' || descriptorType === 'function')) {
        const guardedDescriptor = new Proxy(descriptor, {
          get(targetDescriptor, property) {
            const value = Reflect.get(targetDescriptor, property, targetDescriptor);
            if (property !== 'shared') return value;
            if (value) {
              throw new NotImplementedError(
                'toolchain.threaded-wasm',
                'shared WebAssembly.Memory requires cross-origin isolation and SharedArrayBuffer',
              );
            }
            return value;
          },
        });
        effectiveArgs = [...args];
        effectiveArgs[0] = guardedDescriptor;
      }
      const effectiveNewTarget = newTarget.prototype === target.prototype ? target : newTarget;
      return Reflect.construct(target, effectiveArgs, effectiveNewTarget);
    },
  };
  const GuardedMemory = new Proxy(NativeMemory, memoryHandler);
  return new Proxy(WebAssembly, {
    get(target, property, receiver) {
      return property === 'Memory' ? GuardedMemory : Reflect.get(target, property, receiver);
    },
  });
}
