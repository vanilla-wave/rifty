import { type WorkbenchSession, createWorkbenchSession } from '@riftydev/workbench';
import devServerWorkerUrl from '@riftydev/workbench/dev-server-worker?worker&url';
import kernelWorkerUrl from '@riftydev/workbench/kernel-worker?worker&url';
import nodeWorkerUrl from '@riftydev/workbench/node-worker?worker&url';
import ownerWorkerUrl from '@riftydev/workbench/owner-worker?worker&url';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import esbuildWasmUrl from '../../../../tools/shadow-registry/vendor/esbuild-wasi-preview1/esbuild.wasm?url';
import { PLAYGROUND_PROJECT_CATALOG } from '../glue/workbench-catalog.ts';
import { playgroundRegistryConfig } from '../glue/workbench-host-config.ts';

export interface BrowserUnitWorkbenchOptions {
  readonly workspaceId: string;
  readonly root: string;
  readonly marker: string;
  readonly onLog?: (line: string) => void;
}

function entrySource(marker: string): string {
  return `const marker = ${JSON.stringify(marker)};
const app = document.getElementById('app');
if (!app) throw new Error('Missing #app root');
app.textContent = marker;
if (import.meta.hot) import.meta.hot.accept();
`;
}

/** Vite-owned asset adapter for exercising the package's public composition API. */
export function createBrowserUnitWorkbenchSession(
  options: BrowserUnitWorkbenchOptions,
): WorkbenchSession {
  return createWorkbenchSession({
    assets: {
      ownerWorkerUrl,
      kernelWorkerUrl,
      nodeWorkerUrl,
      devServerWorkerUrl,
      serviceWorkerUrl: '/sw.js',
      sqliteWasmUrl: sqlWasmUrl,
      esbuildWasmUrl,
    },
    registry: playgroundRegistryConfig(),
    project: {
      catalog: PLAYGROUND_PROJECT_CATALOG,
      templateId: 'vite',
      starterId: 'project-files',
      files: [{ path: 'src/main.js', content: entrySource(options.marker) }],
      root: options.root,
      workspaceId: options.workspaceId,
      setup: 'from-scratch',
    },
    serviceWorkerScope: '/',
    previewProbeTimeoutMs: 15_000,
    ...(options.onLog === undefined ? {} : { onLog: options.onLog }),
  });
}
