import { runNodeEntry } from '@riftydev/runtime-js/builtins/node-entry';
import { createModuleLoader, preloadTsconfigPaths } from '@riftydev/runtime-js/loader';
import { runtimeWorkerBackend } from '@riftydev/runtime-js/worker';
import { syncMirror } from '@riftydev/vfs';

self.addEventListener('message', async (event: MessageEvent) => {
  if (event.data?.type !== 'compiler-probe') return;
  await runtimeWorkerBackend;
  const { source, explicitCommonJs, operation } = event.data as {
    source: string;
    explicitCommonJs: boolean;
    operation: 'eval' | 'preload' | 'check-ready' | 'default-paths' | 'explicit-paths';
  };
  let result: unknown;
  try {
    if (operation !== 'eval') {
      const fs = syncMirror();
      fs.mkdirSync('/config-probe/src', { recursive: true });
      fs.writeFileSync(
        '/config-probe/tsconfig.json',
        new TextEncoder().encode('{ // JSONC\n "compilerOptions": { "baseUrl": "src" } }'),
      );
      fs.writeFileSync(
        '/config-probe/src/value.js',
        new TextEncoder().encode('module.exports = 42;'),
      );
      if (operation === 'preload') await preloadTsconfigPaths();
      const loader = createModuleLoader(
        fs,
        operation === 'default-paths'
          ? {}
          : operation === 'explicit-paths'
            ? { paths: { value: '/config-probe/src/value.js' } }
            : { cwd: '/config-probe', autoDiscoverTsconfigPaths: true },
      );
      result = {
        ok: true,
        value: loader.require(
          operation === 'default-paths' ? './src/value.js' : 'value',
          '/config-probe/main.js',
        ),
      };
    } else {
      await runNodeEntry({
        kind: 'eval',
        vfs: syncMirror(),
        cwd: '/work',
        source,
        print: false,
        explicitCommonJs,
      });
      result = { ok: true, value: Reflect.get(globalThis, '__compilerProbe') };
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    result = {
      ok: false,
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: String(error.cause),
      feature: Reflect.get(error, 'feature'),
      code: Reflect.get(error, 'code'),
    };
  }
  // The DOM-only consumer fixture uses the common postMessage method shape.
  (self as unknown as Worker).postMessage({ type: 'compiler-result', result });
});
