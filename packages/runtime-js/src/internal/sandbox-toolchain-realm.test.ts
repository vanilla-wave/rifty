import { afterEach, describe, expect, it } from 'vitest';
import { sandboxToolchainWebAssembly } from './sandbox-toolchain-realm.ts';

const TOOLCHAIN_REALM = Symbol.for('rifty.runtime-js.sandbox-toolchain.v1');

interface MemoryObservation {
  readonly log: readonly string[];
  readonly sharedReads: number;
  readonly bufferBrand?: string;
  readonly error?: { readonly name: string; readonly feature?: string };
}

function observeMemory(
  Memory: typeof WebAssembly.Memory,
  shared: (read: number) => unknown,
): MemoryObservation {
  const log: string[] = [];
  let sharedReads = 0;
  const descriptor = Object.defineProperties(
    {},
    {
      initial: {
        configurable: true,
        get() {
          log.push('initial');
          return 1;
        },
      },
      maximum: {
        configurable: true,
        get() {
          log.push('maximum');
          return 1;
        },
      },
      shared: {
        configurable: true,
        get() {
          log.push('shared');
          sharedReads += 1;
          return shared(sharedReads);
        },
      },
    },
  ) as WebAssembly.MemoryDescriptor;

  try {
    const memory = new Memory(descriptor);
    return {
      log,
      sharedReads,
      bufferBrand: Object.prototype.toString.call(memory.buffer),
    };
  } catch (error) {
    const inspected = error as Error & { readonly feature?: string };
    return {
      log,
      sharedReads,
      error: { name: inspected.name, feature: inspected.feature },
    };
  }
}

function selectToolchainRealm(): typeof WebAssembly {
  Object.defineProperty(globalThis, TOOLCHAIN_REALM, { value: true, configurable: true });
  return sandboxToolchainWebAssembly();
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, TOOLCHAIN_REALM);
});

describe('sandbox toolchain WebAssembly.Memory descriptor evaluation', () => {
  it('records the native Node v24.16.0 order and single-read oracle', () => {
    expect(process.version).toBe('v24.16.0');
    expect(observeMemory(WebAssembly.Memory, (read) => read > 1)).toEqual({
      log: ['initial', 'maximum', 'shared'],
      sharedReads: 1,
      bufferBrand: '[object ArrayBuffer]',
    });
  });

  it('matches native order and cardinality through the selected realm seam', () => {
    expect(observeMemory(selectToolchainRealm().Memory, () => false)).toEqual(
      observeMemory(WebAssembly.Memory, () => false),
    );
  });

  it('consumes a false-then-true shared accessor once and stays non-shared', () => {
    expect(observeMemory(selectToolchainRealm().Memory, (read) => read > 1)).toEqual({
      log: ['initial', 'maximum', 'shared'],
      sharedReads: 1,
      bufferBrand: '[object ArrayBuffer]',
    });
  });

  it('evaluates native fields before surfacing the named first-read truthy gap', () => {
    expect(observeMemory(selectToolchainRealm().Memory, () => 'truthy')).toEqual({
      log: ['initial', 'maximum', 'shared'],
      sharedReads: 1,
      error: { name: 'NotImplementedError', feature: 'toolchain.threaded-wasm' },
    });
  });

  it('keeps the caller descriptor as the receiver of private-field accessors', () => {
    const log: string[] = [];
    class Descriptor {
      readonly initial = 1;
      readonly maximum = 1;
      readonly #shared = false;

      get shared(): boolean {
        log.push('shared');
        return this.#shared;
      }
    }

    const memory = new (selectToolchainRealm().Memory)(new Descriptor());
    expect(log).toEqual(['shared']);
    expect(Object.prototype.toString.call(memory.buffer)).toBe('[object ArrayBuffer]');
  });

  it('preserves a non-configurable falsey shared data property', () => {
    const descriptor = Object.defineProperties(
      {},
      {
        initial: { value: 1 },
        shared: { value: 0 },
      },
    ) as WebAssembly.MemoryDescriptor;

    const memory = new (selectToolchainRealm().Memory)(descriptor);
    expect(Object.prototype.toString.call(memory.buffer)).toBe('[object ArrayBuffer]');
  });

  it('leaves maximum and shared unread when initial conversion throws', () => {
    const log: string[] = [];
    const failure = new Error('initial conversion');
    const descriptor = Object.defineProperties(
      {},
      {
        initial: {
          get() {
            log.push('initial');
            return {
              valueOf() {
                log.push('initial:valueOf');
                throw failure;
              },
            };
          },
        },
        maximum: { get: () => log.push('maximum') },
        shared: { get: () => log.push('shared') },
      },
    ) as WebAssembly.MemoryDescriptor;

    expect(() => new (selectToolchainRealm().Memory)(descriptor)).toThrow(failure);
    expect(log).toEqual(['initial', 'initial:valueOf']);
  });

  it('keeps the Worker-global constructor and non-shared identities native', () => {
    const NativeMemory = WebAssembly.Memory;
    const lexical = selectToolchainRealm();
    const memory = new lexical.Memory({ initial: 1 });
    class DerivedMemory extends lexical.Memory {}
    const derived = new DerivedMemory({ initial: 1 });

    expect(WebAssembly.Memory).toBe(NativeMemory);
    expect(memory.constructor).toBe(NativeMemory);
    expect(Object.getPrototypeOf(memory)).toBe(NativeMemory.prototype);
    expect(derived.constructor).toBe(DerivedMemory);
    expect(Object.getPrototypeOf(derived)).toBe(DerivedMemory.prototype);
    expect(derived).toBeInstanceOf(DerivedMemory);
  });
});
