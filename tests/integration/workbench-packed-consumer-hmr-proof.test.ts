import { describe, expect, it } from 'vitest';
import { assertPackedConsumerHmrProof } from './workbench-packed-consumer-hmr-proof.mjs';

const nativeUpdate = {
  type: 'update',
  updates: [{ path: '/src/main.ts', acceptedPath: '/src/message.ts' }],
};

describe('packed Workbench native HMR proof', () => {
  it('accepts the native dependency update while the preview document survives', () => {
    expect(() =>
      assertPackedConsumerHmrProof({
        expectedSentinel: 'same-document',
        sentinel: 'same-document',
        beforeUnload: null,
        messages: [nativeUpdate],
      }),
    ).not.toThrow();
  });

  it('rejects a content-correct full reload even when its prior document saw the update', () => {
    expect(() =>
      assertPackedConsumerHmrProof({
        expectedSentinel: 'previous-document',
        sentinel: null,
        beforeUnload: '1',
        messages: [nativeUpdate],
      }),
    ).toThrow('replaced the preview document');
  });

  it('rejects a same-document edit without Vite native update provenance', () => {
    expect(() =>
      assertPackedConsumerHmrProof({
        expectedSentinel: 'same-document',
        sentinel: 'same-document',
        beforeUnload: null,
        messages: [],
      }),
    ).toThrow("missed Vite's native dependency update");
  });
});
