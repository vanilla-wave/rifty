import { describe, expect, it } from 'vitest';
import * as kernel from '../src/index.ts';

describe('entry capability package-root surface', () => {
  it('exports consume but keeps publication internals private', () => {
    expect(kernel.consumeKernelEntryCapabilityPorts).toBeTypeOf('function');
    for (const name of [
      'KERNEL_ENTRY_CAPABILITY_PORTS_KEY',
      'publishKernelEntryCapabilityPorts',
      'readKernelEntryCapabilityPorts',
      'snapshotKernelEntryCapabilityPorts',
    ]) {
      expect(name in kernel).toBe(false);
    }
  });
});
