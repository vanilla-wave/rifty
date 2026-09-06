/// <reference lib="webworker" />

import type { ToolchainWorkerMessage } from '../../../packages/runtime-js/src/protocol.ts';
import { syncMirror } from '../../../packages/vfs/src/index.ts';

declare const self: DedicatedWorkerGlobalScope;
const nativePost = self.postMessage.bind(self);
// Observe the real Worker/VFS at the outgoing structured-clone boundary.
self.postMessage = (...args: Parameters<DedicatedWorkerGlobalScope['postMessage']>) => {
  const message = args[0] as ToolchainWorkerMessage;
  if (message.type === 'toolchain-result' && message.result.ok) {
    const value = message.result.value;
    if (value && 'activationState' in value) {
      const files = value.activationState.files;
      nativePost({
        type: 'recovery-probe',
        bytes: files.reduce((total, file) => total + file.data.byteLength, 0),
        reusedMirrorBytes: files.every(
          (file) => file.data === syncMirror().readFileBytesSync(file.path),
        ),
      });
    }
  }
  return Reflect.apply(nativePost, self, args);
};

await import('../../../packages/workbench/src/workers/no-coi-toolchain-worker.ts');
