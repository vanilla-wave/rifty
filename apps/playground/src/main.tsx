// COI guard runs first: imports below have module-level side effects (kernel
// registry, VFS backend) that assume SharedArrayBuffer + Atomics, i.e. cross-origin
// isolation. Missing headers must fail loud, not yield a black screen. ADR-0002 / D-001.
import { setKernelWorkerUrl } from '@riftydev/kernel';
import { setNodeEntryWorkerUrl } from '@riftydev/runtime-js/builtins/node-entry-url';
import { render } from 'solid-js/web';
import { App } from './App.tsx';
import { assertCrossOriginIsolated, bootstrapPlayground } from './boot.ts';
import { createTerminalPersistence } from './glue/terminal-persistence.ts';
// `?worker&url` bundles the kernel child-worker entry + yields its URL. The bare
// `new URL(..., import.meta.url)` form isn't emitted as a worker chunk by `vite build`,
// so child processes failed to spawn in prod.
import kernelWorkerUrl from './workers/kernel-worker-entry.ts?worker&url';
// The `kind:'url'` node-entry bootstrap (ADR-0137): runs a VFS Node program /
// `.bin` launcher through the module loader. `child_process`/`execSync` (in
// runtime-js, below this host) can't reference this bundled URL directly, so we
// inject it — mirrors `setKernelWorkerUrl`.
import nodeEntryBootstrapUrl from './workers/node-entry-bootstrap.ts?worker&url';
// xterm's stylesheet is required for terminal scrolling (`.xterm-viewport` position +
// absolute row layout). Imported here (not via index.html <link>) so Vite bundles it in
// dev AND prod — a bare `/@xterm/...` href hits the SPA fallback (200 HTML), silently ignored.
import '@xterm/xterm/css/xterm.css';
import './styles/theme.css';

const WORKSPACE = '/workspace';

// Fail loud if COI is off, before VFS detection / SW registration, so the error
// is painted as early as possible.
assertCrossOriginIsolated();

// ADR-0011 phase 2 — give the kernel the Worker-entry URL for spawned children;
// the kernel never hardcodes a path.
setKernelWorkerUrl(kernelWorkerUrl);

// ADR-0137 — give runtime-js (`child_process`/`execSync`) the node-entry
// bootstrap URL so a spawned `node <script>` runs through the module loader.
setNodeEntryWorkerUrl(nodeEntryBootstrapUrl);

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

  // ADR-0013 — pick OPFS vs memory + register the SW before the UI sees the
  // runtime. Pipeline: re-assert COI (defence-in-depth), init VFS (memory
  // fallback on failure), register `/sw.js` (banner on failure, not fatal).
  const bootResult = await bootstrapPlayground();
  const terminalPersistence = await createTerminalPersistence(WORKSPACE);
  // Drop the index.html cold-boot skeleton before mounting (Solid's render into a
  // non-empty container would otherwise leave the skeleton behind the app).
  root.replaceChildren();
  render(() => <App boot={bootResult} terminalPersistence={terminalPersistence} />, root);
}
