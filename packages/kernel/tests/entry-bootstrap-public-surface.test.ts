import { describe, expect, it } from 'vitest';
import * as kernel from '../src/index.ts';

describe('kernel entry bootstrap public surface', () => {
  it('exposes clone metadata but no runtime-byte capability-port carrier', () => {
    expect(kernel.readKernelEntryBootstrap).toBeTypeOf('function');
    expect(kernel).not.toHaveProperty('consumeKernelEntryCapabilityPorts');
    expect(Object.keys(kernel).sort()).toEqual([
      'DEFAULT_CWD',
      'DEFAULT_PAYLOAD_CAPACITY',
      'FRAME_BINARY',
      'FRAME_JSON',
      'KERNEL_ENTRY_BOOTSTRAP_KEY',
      'KERNEL_PROCESS_SPEC_KEY',
      'KERNEL_SYNC_BINARY_CALL_KEY',
      'KERNEL_SYNC_CALL_KEY',
      'ProcessManager',
      'RingPayloadTooLargeError',
      'RingTimeoutError',
      'SAB_RING_HEADER_BYTES',
      'SYNC_RPC_PROTOCOL_VERSION',
      'SabRing',
      'SyncRpcClient',
      'SyncRpcDispatcher',
      'SyncRpcProtocolMismatchError',
      'clearKernelDispatcher',
      'createSabRing',
      'decodeIpcFrame',
      'decodeReply',
      'decodeRequest',
      'encodeBinaryReply',
      'encodeBinaryRequest',
      'encodeReply',
      'encodeRequest',
      'formatProcessSnapshot',
      'getIpcMode',
      'getKernelDispatcher',
      'getKernelDrainHook',
      'getKernelPreEntryHook',
      'getKernelWorkerUrl',
      'globalProcessManager',
      'isSabIpcSupported',
      'observeProcessTerminalOutcome',
      'publishKernelEntryBootstrap',
      'publishKernelProcessSpec',
      'publishKernelSyncApi',
      'readKernelEntryBootstrap',
      'readKernelProcessSpec',
      'readKernelSyncApi',
      'readRootProcessSnapshot',
      'setKernelDrainHook',
      'setKernelPreEntryHook',
      'setKernelWorkerUrl',
      'spawnKernelWorker',
    ]);
  });
});
