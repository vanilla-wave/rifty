import { runNodeEntry } from '@riftydev/runtime-js/builtins/node-entry';
import { runtimeWorkerBackend } from '@riftydev/runtime-js/worker';
import { syncMirror } from '@riftydev/vfs';

self.addEventListener('message', async (event: MessageEvent) => {
  if (event.data?.type !== 'compiler-probe') return;
  await runtimeWorkerBackend;
  const { source, explicitCommonJs } = event.data as { source: string; explicitCommonJs: boolean };
  let result: unknown;
  try {
    await runNodeEntry({
      kind: 'eval',
      vfs: syncMirror(),
      cwd: '/work',
      source,
      print: false,
      explicitCommonJs,
    });
    result = { ok: true, value: Reflect.get(globalThis, '__compilerProbe') };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    result = {
      ok: false,
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: String(error.cause),
      feature: Reflect.get(error, 'feature'),
    };
  }
  // The DOM-only consumer fixture uses the common postMessage method shape.
  (self as unknown as Worker).postMessage({ type: 'compiler-result', result });
});
