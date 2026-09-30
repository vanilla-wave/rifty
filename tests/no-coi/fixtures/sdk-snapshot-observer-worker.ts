/// <reference lib="webworker" />
import { OpfsFsSync } from '../../../packages/vfs/src/index.ts';
declare const self: DedicatedWorkerGlobalScope;
const nativeFlush = OpfsFsSync.prototype.flush;
OpfsFsSync.prototype.flush = async function (options) {
  const counts: { persisted: number; total: number }[] = [];
  const report = await nativeFlush.call(this, {
    ...options,
    onProgress(count) {
      counts.push(count);
      options?.onProgress?.(count);
    },
  });
  self.postMessage({ type: 'native-flush-receipt', counts, failed: report.total });
  return report;
};

// Delay actual product frames at the native transport boundary; never fabricate them.
if (new URL(import.meta.url).searchParams.has('late-frames')) {
  const nativePost = self.postMessage.bind(self);
  const held: unknown[] = [];
  self.postMessage = (message: unknown, options?: Transferable[] | StructuredSerializeOptions) => {
    const frame = message as { type?: unknown; operation?: unknown; phase?: unknown } | null;
    if (frame?.type === 'progress' && frame.operation === 'snapshot' && frame.phase === 'entries') {
      held.push(structuredClone(message));
      return;
    }
    Reflect.apply(nativePost, self, options === undefined ? [message] : [message, options]);
  };
  self.addEventListener('message', ({ data }) => {
    if (data?.type !== 'fixture-release-late-progress') return;
    for (const frame of held) nativePost(frame);
    nativePost({ type: 'fixture-late-progress-released', count: held.length });
    held.length = 0;
  });
}

await import('../../../packages/workbench/src/workers/no-coi-toolchain-worker.ts');
