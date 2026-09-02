/// <reference lib="webworker" />

import quickjsWasmUrl from '@jitl/quickjs-wasmfile-release-sync/wasm?url';
import { QUICKJS_WASM_URL_ENV } from '@riftydev/runtime-js/install-process';
import '@riftydev/workbench/kernel-worker';

(globalThis as unknown as Record<typeof QUICKJS_WASM_URL_ENV, string>)[QUICKJS_WASM_URL_ENV] =
  quickjsWasmUrl;
