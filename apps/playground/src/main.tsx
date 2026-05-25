import { setKernelWorkerUrl } from '@rifty/kernel';
import { render } from 'solid-js/web';
import { App } from './App.tsx';

// ADR-0011 phase 2 — hand the kernel a URL to the Worker entry it should
// instantiate for each spawned child. Vite resolves the URL at build time
// and emits the worker chunk; the kernel never hardcodes a path.
setKernelWorkerUrl(new URL('./workers/kernel-worker-entry.ts', import.meta.url));

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root element');
render(() => <App />, root);
