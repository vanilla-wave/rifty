import {
  type SyncBinaryCall,
  type SyncCall,
  SyncRpcFsSync,
  installRemoteSyncFs,
} from './sync-rpc-fs.ts';

export interface FsTestSyncApi {
  readonly call: SyncCall;
  readonly callBinary: SyncBinaryCall;
}

/** Strict two-operation test adapter; no callable/legacy fallback shape. */
export function fsTestSyncApi(call: SyncCall): FsTestSyncApi {
  return {
    call,
    callBinary(method, payload) {
      if (method === 'fs.readChunk') {
        if (payload.length < 16) throw new TypeError('test fs binary range is truncated');
        const view = new DataView(payload.buffer, payload.byteOffset, 16);
        return call(method, {
          offset: view.getFloat64(0, true),
          length: view.getFloat64(8, true),
          path: new TextDecoder('utf-8', { fatal: true }).decode(payload.subarray(16)),
        });
      }
      return call(method, {
        path: new TextDecoder('utf-8', { fatal: true }).decode(payload),
      });
    },
  };
}

export function createTestSyncRpcFs(call: SyncCall): SyncRpcFsSync {
  const api = fsTestSyncApi(call);
  return new SyncRpcFsSync(api.call, api.callBinary);
}

export function installTestSyncRpcFs(call: SyncCall): SyncRpcFsSync {
  const api = fsTestSyncApi(call);
  return installRemoteSyncFs(api.call, api.callBinary);
}
