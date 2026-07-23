// COI guard runs first: imports below have module-level side effects (kernel
// registry, VFS backend) that assume SharedArrayBuffer + Atomics, i.e. cross-origin
// isolation. Missing headers must fail loud, not yield a black screen. ADR-0002 / D-001.
import { render } from 'solid-js/web';
import { App } from './App.tsx';
import { mountPlaygroundPage } from './adapters/playground-page-entry.ts';
import { openPlaygroundAppWorkbench } from './adapters/playground-workbench-host.ts';
import { assertCrossOriginIsolated, bootstrapPlayground } from './boot.ts';
import { BootFailure } from './components/BootFailure.tsx';
import { WorkspaceOccupied } from './components/WorkspaceOccupied.tsx';
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

// e2e-only: the execSync-over-SAB harness (tests/e2e/execsync-sab.spec.ts).
// Gated on `#test=execsync` so normal playground boot is untouched. Runs in the
// page realm (which owns the kernel dispatcher), installs its own explicit
// worker fixture, spawns a guest worker, and paints the byte-exact execSync
// result into the DOM. Lazy-imported so the harness chunk never loads on a
// normal page.
if (location.hash.includes('test=execsync')) {
  const { runExecSyncHarness } = await import('./execsync-harness.ts');
  await runExecSyncHarness();
} else {
  await renderApp();
}

async function renderApp(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('Missing #app root element');

  // Retry re-enters the same finite transaction, so each mount disposes the
  // previous Solid root before painting into the shared #app container.
  let disposePrevious: (() => void) | null = null;
  const mount = (paint: () => ReturnType<typeof render>): void => {
    disposePrevious?.();
    root.replaceChildren();
    disposePrevious = paint();
  };

  const startPageEntry = (): Promise<void> =>
    mountPlaygroundPage({
      bootstrapPlayground,
      openPlaygroundAppWorkbench,
      createTerminalPersistence: () => createTerminalPersistence(WORKSPACE),
      mountOccupied() {
        mount(() =>
          render(() => <WorkspaceOccupied onReload={() => globalThis.location.reload()} />, root),
        );
      },
      mountApp(props) {
        // Drop the index.html cold-boot skeleton only after Workbench admission.
        mount(() => render(() => <App {...props} />, root));
      },
      mountFatal(error) {
        mount(() =>
          render(
            () => (
              <BootFailure
                error={error}
                onRetry={() =>
                  void startPageEntry().catch((retryFailure: unknown) =>
                    console.error('[playground] page entry retry failed', retryFailure),
                  )
                }
                onReload={() => globalThis.location.reload()}
              />
            ),
            root,
          ),
        );
      },
    });

  await startPageEntry();
}
