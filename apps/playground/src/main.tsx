// COI guard runs before everything else. Imports below trigger module-level
// side effects (kernel registry, VFS backend selection) that all assume
// SharedArrayBuffer + Atomics — i.e. cross-origin isolation. If the headers
// aren't set we want a visible, unambiguous failure instead of a black screen
// or a confusing downstream error. See ADR-0002 / D-001.
import { setKernelWorkerUrl } from '@riftydev/kernel';
import { render } from 'solid-js/web';
import { App } from './App.tsx';
import { assertCrossOriginIsolated, bootstrapPlayground } from './boot.ts';

// First statement — fails loud if COI is off. Runs *before* `bootstrapPlayground`
// would re-invoke the guard, so the error message is painted as soon as
// possible (even before VFS detection or SW registration runs).
assertCrossOriginIsolated();

// ADR-0011 phase 2 — hand the kernel a URL to the Worker entry it should
// instantiate for each spawned child. Vite resolves the URL at build time
// and emits the worker chunk; the kernel never hardcodes a path.
setKernelWorkerUrl(new URL('./workers/kernel-worker-entry.ts', import.meta.url));

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root element');

// ADR-0013 — pick OPFS vs memory and register the Service Worker BEFORE the
// UI sees the runtime. The single bootstrap pipeline (1) re-asserts COI for
// defence-in-depth, (2) initialises the VFS (memory fallback on failure),
// (3) registers `/sw.js` (banner on failure — not fatal). Render only starts
// once all three steps have settled.
const bootResult = await bootstrapPlayground();
render(() => <App boot={bootResult} />, root);
