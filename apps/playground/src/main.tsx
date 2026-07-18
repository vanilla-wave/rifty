// COI guard runs first: imports below have module-level side effects (kernel
// registry, VFS backend) that assume SharedArrayBuffer + Atomics, i.e. cross-origin
// isolation. Missing headers must fail loud, not yield a black screen. ADR-0002 / D-001.
import { render } from 'solid-js/web';
import { App } from './App.tsx';
import { mountPlaygroundPage } from './adapters/playground-page-entry.ts';
import { openPlaygroundAppWorkbench } from './adapters/playground-workbench-host.ts';
import { assertCrossOriginIsolated, bootstrapPlayground } from './boot.ts';
import { WorkspaceOccupied } from './components/WorkspaceOccupied.tsx';
import { installPlaygroundNodeWorkerRuntime } from './glue/playground-node-worker-runtime.ts';
import { createTerminalPersistence } from './glue/terminal-persistence.ts';
// xterm's stylesheet is required for terminal scrolling (`.xterm-viewport` position +
// absolute row layout). Imported here (not via index.html <link>) so Vite bundles it in
// dev AND prod — a bare `/@xterm/...` href hits the SPA fallback (200 HTML), silently ignored.
import '@xterm/xterm/css/xterm.css';
import './styles/theme.css';

const WORKSPACE = '/workspace';

// Fail loud if COI is off, before VFS detection / SW registration, so the error
// is painted as early as possible.
assertCrossOriginIsolated();

// ADR-0267 — install the worker URLs + WASM assets every recursive Node realm
// receives through its entry-scoped bootstrap; guest process.env stays user-owned.
installPlaygroundNodeWorkerRuntime();

// e2e-only: the execSync-over-SAB harness (tests/e2e/execsync-sab.spec.ts).
// Gated on `#test=execsync` so normal playground boot is untouched. Runs in the
// page realm (which owns the kernel dispatcher), spawns a guest worker, and
// paints the byte-exact execSync result into the DOM. Lazy-imported so the
// harness chunk never loads on a normal page.
if (location.hash.includes('test=execsync')) {
  const { runExecSyncHarness } = await import('./execsync-harness.ts');
  await runExecSyncHarness();
} else {
  await renderApp();
}

async function renderApp(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('Missing #app root element');

  await mountPlaygroundPage({
    bootstrapPlayground,
    openPlaygroundAppWorkbench,
    createTerminalPersistence: () => createTerminalPersistence(WORKSPACE),
    mountOccupied() {
      root.replaceChildren();
      render(() => <WorkspaceOccupied onReload={() => globalThis.location.reload()} />, root);
    },
    mountApp(props) {
      // Drop the index.html cold-boot skeleton only after Workbench admission.
      root.replaceChildren();
      render(() => <App {...props} />, root);
    },
  });
}
