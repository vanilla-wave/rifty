import { setKernelWorkerUrl } from '@rifty/kernel';
import { render } from 'solid-js/web';
import { App } from './App.tsx';
import { bootstrap } from './boot.ts';

// ADR-0011 phase 2 — hand the kernel a URL to the Worker entry it should
// instantiate for each spawned child. Vite resolves the URL at build time
// and emits the worker chunk; the kernel never hardcodes a path.
setKernelWorkerUrl(new URL('./workers/kernel-worker-entry.ts', import.meta.url));

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root element');

// ADR-0013 — pick OPFS vs memory before the UI sees the VFS. Failure falls
// back to memory and surfaces a reason so the badge in `App` can flag it;
// rendering never blocks on storage.
const vfsBoot = await bootstrap();
render(() => <App vfsBoot={vfsBoot} />, root);
