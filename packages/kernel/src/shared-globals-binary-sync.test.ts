import { afterEach, describe, expect, it } from 'vitest';
import { KERNEL_SYNC_CALL_KEY, publishKernelSyncApi, readKernelSyncApi } from './shared-globals.ts';

const BINARY_KEY = '__riftyKernelSyncBinaryCall';

afterEach(() => {
  Reflect.deleteProperty(globalThis, KERNEL_SYNC_CALL_KEY);
  Reflect.deleteProperty(globalThis, BINARY_KEY);
});

describe('ADR-0366 published KernelSyncApi', () => {
  it('round-trips required JSON and binary calls as non-enumerable hooks', () => {
    const call = () => 'json';
    const callBinary = () => 'binary';
    publishKernelSyncApi({ call, callBinary } as never);
    expect(readKernelSyncApi()).toEqual({ call, callBinary });
    expect(Object.getOwnPropertyDescriptor(globalThis, KERNEL_SYNC_CALL_KEY)?.enumerable).toBe(
      false,
    );
    expect(Object.getOwnPropertyDescriptor(globalThis, BINARY_KEY)?.enumerable).toBe(false);
  });

  it('returns null only when both hooks are absent and rejects either partial publication', () => {
    expect(readKernelSyncApi()).toBeNull();
    Object.defineProperty(globalThis, KERNEL_SYNC_CALL_KEY, {
      value: () => null,
      configurable: true,
    });
    expect(() => readKernelSyncApi()).toThrow(/partial|binary/i);
    Reflect.deleteProperty(globalThis, KERNEL_SYNC_CALL_KEY);
    Object.defineProperty(globalThis, BINARY_KEY, { value: () => null, configurable: true });
    expect(() => readKernelSyncApi()).toThrow(/partial|json/i);
  });
});
