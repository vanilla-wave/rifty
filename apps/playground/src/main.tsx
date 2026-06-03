// COI guard runs before everything else. Imports below trigger module-level
// side effects (kernel registry, VFS backend selection) that all assume
// SharedArrayBuffer + Atomics — i.e. cross-origin isolation. If the headers
// aren't set we want a visible, unambiguous failure instead of a black screen
// or a confusing downstream error. See ADR-0002 / D-001.
import { setKernelWorkerUrl } from '@riftydev/kernel';
import { render } from 'solid-js/web';
import { App } from './App.tsx';
import { assertCrossOriginIsolated, bootstrapPlayground } from './boot.ts';
// `?worker&url` bundles the kernel child-worker entry and yields its URL.
// See the matching note in adapters/useRuntime.ts: the bare
// `new URL(..., import.meta.url)` form is not emitted as a worker chunk by
// `vite build`, so child processes failed to spawn in production.
import kernelWorkerUrl from './workers/kernel-worker-entry.ts?worker&url';
import './styles/theme.css';

// First statement — fails loud if COI is off. Runs *before* `bootstrapPlayground`
// would re-invoke the guard, so the error message is painted as soon as
// possible (even before VFS detection or SW registration runs).
assertCrossOriginIsolated();

// ADR-0011 phase 2 — hand the kernel a URL to the Worker entry it should
// instantiate for each spawned child. Vite bundles the worker chunk at build
// time (via the `?worker&url` import above); the kernel never hardcodes a path.
setKernelWorkerUrl(kernelWorkerUrl);

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root element');

// ADR-0013 — pick OPFS vs memory and register the Service Worker BEFORE the
// UI sees the runtime. The single bootstrap pipeline (1) re-asserts COI for
// defence-in-depth, (2) initialises the VFS (memory fallback on failure),
// (3) registers `/sw.js` (banner on failure — not fatal). Render only starts
// once all three steps have settled.
const bootResult = await bootstrapPlayground();
render(() => <App boot={bootResult} />, root);
