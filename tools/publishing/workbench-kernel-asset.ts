/// <reference lib="webworker" />

import { QUICKJS_WASM_URL_ENV } from '@riftydev/runtime-js/install-process';
import '@riftydev/workbench/kernel-worker';

(globalThis as unknown as Record<typeof QUICKJS_WASM_URL_ENV, string>)[QUICKJS_WASM_URL_ENV] =
  new URL('./quickjs.wasm', import.meta.url).href;
