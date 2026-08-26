import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSabRing } from './sab-ring.ts';
import { SyncRpcClient } from './sync-client.ts';

beforeEach(() => {
  vi.stubGlobal('WorkerGlobalScope', function WorkerGlobalScope() {});
  vi.stubGlobal('postMessage', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('[fault: sibling-drift] SyncRpcClient encoding forensics', () => {
  it('keeps JSON and binary encoding failures inside the shared call context', () => {
    const client = new SyncRpcClient(createSabRing({ payloadCapacity: 256 }).ring);
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(() => client.call('cyclic-json', cyclic)).toThrow(
      /sync-rpc call 'cyclic-json' failed: .*circular/i,
    );
    expect(() => client.callBinary('', new Uint8Array(0))).toThrow(
      /sync-rpc call '' failed: .*method.*empty/i,
    );
  });
});
