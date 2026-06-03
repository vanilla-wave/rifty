// This file is the URL passed to `new Worker(url, { type: 'module' })`.
// It re-exports the runtime-js worker module so Vite bundles dependencies
// (including `es-module-lexer`) properly.
import '@riftydev/runtime-js/worker';
