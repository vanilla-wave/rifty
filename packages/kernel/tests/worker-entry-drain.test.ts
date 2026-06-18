import { describe, expect, it } from 'vitest';
import {
  type KernelDrainHook,
  getKernelDrainHook,
  setKernelDrainHook,
} from '../src/worker-entry.ts';

describe('kernel drain hook', () => {
  it('registers and reads back the drain hook (idempotent replace, null unregisters)', () => {
    const hook: KernelDrainHook = async () => {};
    setKernelDrainHook(hook);
    expect(getKernelDrainHook()).toBe(hook);
    setKernelDrainHook(null);
    expect(getKernelDrainHook()).toBeNull();
  });
});
