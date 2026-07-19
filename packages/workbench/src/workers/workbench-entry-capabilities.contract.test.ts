import {
  KERNEL_ENTRY_CAPABILITY_PORTS_KEY,
  publishKernelEntryCapabilityPorts,
} from '@riftydev/kernel';
import { SHADOW_ASSET_CAPABILITY } from '@riftydev/npm-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closeUnusedWorkbenchEntryCapabilities,
  consumeWorkbenchEntryCapabilities,
} from './workbench-entry-capabilities.ts';

afterEach(() => {
  publishKernelEntryCapabilityPorts(null);
});

describe('Workbench privileged entry capability handoff', () => {
  it('consumes one known port before guest import and promptly closes its peer when unused', async () => {
    const channel = new MessageChannel();
    const close = vi.spyOn(channel.port2, 'close');
    const peerClosed = vi.fn();
    channel.port1.addEventListener('close', peerClosed, { once: true });
    channel.port1.start();
    publishKernelEntryCapabilityPorts({ [SHADOW_ASSET_CAPABILITY]: channel.port2 });

    const capabilities = consumeWorkbenchEntryCapabilities();

    expect(capabilities[SHADOW_ASSET_CAPABILITY]).toBe(channel.port2);
    expect(Object.getOwnPropertyNames(globalThis)).not.toContain(KERNEL_ENTRY_CAPABILITY_PORTS_KEY);
    expect(close).not.toHaveBeenCalled();
    closeUnusedWorkbenchEntryCapabilities(capabilities);
    expect(close).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(peerClosed).toHaveBeenCalledTimes(1));
    channel.port1.close();
  });

  it('closes every endpoint and loud-fails an unknown protocol before guest import', () => {
    const known = new MessageChannel();
    const unknown = new MessageChannel();
    const knownClose = vi.spyOn(known.port2, 'close');
    const unknownClose = vi.spyOn(unknown.port2, 'close');
    publishKernelEntryCapabilityPorts({
      [SHADOW_ASSET_CAPABILITY]: known.port2,
      'test.unknown': unknown.port2,
    });

    expect(() => consumeWorkbenchEntryCapabilities()).toThrow(
      'unsupported Workbench entry capabilities: test.unknown',
    );
    expect(knownClose).toHaveBeenCalledTimes(1);
    expect(unknownClose).toHaveBeenCalledTimes(1);
    expect(Object.getOwnPropertyNames(globalThis)).not.toContain(KERNEL_ENTRY_CAPABILITY_PORTS_KEY);
    known.port1.close();
    unknown.port1.close();
  });

  it('attempts every close and keeps protocol mismatch first when cleanup also fails', () => {
    const known = new MessageChannel();
    const unknown = new MessageChannel();
    const closeFailure = new Error('known endpoint close failed');
    const knownClose = vi.spyOn(known.port2, 'close').mockImplementation(() => {
      throw closeFailure;
    });
    const unknownClose = vi.spyOn(unknown.port2, 'close');
    publishKernelEntryCapabilityPorts({
      [SHADOW_ASSET_CAPABILITY]: known.port2,
      'test.unknown': unknown.port2,
    });

    let failure: unknown;
    try {
      consumeWorkbenchEntryCapabilities();
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      expect.objectContaining({
        message: 'unsupported Workbench entry capabilities: test.unknown',
      }),
      closeFailure,
    ]);
    expect(knownClose).toHaveBeenCalledTimes(1);
    expect(unknownClose).toHaveBeenCalledTimes(1);
    knownClose.mockRestore();
    known.port1.close();
    known.port2.close();
    unknown.port1.close();
  });
});
