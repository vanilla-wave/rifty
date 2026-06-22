/// <reference lib="webworker" />

/**
 * TS language-service serve-worker entry (ADR-0166 P1.9a). The owner spawns this
 * as a `kind:'url'`, `serve:true` child reading the owner store over fs.* sync-RPC
 * (RIFTY_REMOTE_FS=1) — same recursive-spawn shape as the dev-server child.
 *
 * The kernel ALWAYS loads the fixed `kernel-worker-entry` (setKernelWorkerUrl)
 * for every spawn: it publishes the sync-call shim + process spec, runs the
 * pre-entry hook (installs `globalThis.process`), THEN dynamically imports THIS
 * `spec.entry.url`. So by the time this module evaluates, `readKernelSyncApi()`
 * is non-null AND the fork-IPC `process.send/on` surface is installed — exactly
 * the two preconditions the package entry's auto-boot guard checks.
 *
 * This wrapper only forwards to the package's boot. Importing
 * `@riftydev/ts-language-service/worker/entry` runs its bottom-of-module auto-boot
 * (worker realm + sync API present) which builds the FsSync over the owner's fs.*
 * RPC, the createTsLanguageService, and serves the `rifty:ts-lsp` protocol over
 * fork-IPC.
 *
 * The package's `sideEffects` only whitelists the BUILT `dist/worker/entry.js`;
 * in dev Vite resolves the subpath to `src/worker/entry.ts`, which a tree-shaker
 * may treat as side-effect-free and elide the auto-boot. Mirror
 * `kernel-worker-entry.ts`: bind the named export and call it explicitly so the
 * emitted worker chunk cannot collapse to an empty module (the call is a no-op
 * the SECOND time — the package guards a double-boot via the same precondition
 * checks; here it runs once because the auto-boot already fired or, if elided,
 * this call performs it). Belt-and-suspenders against the dev tree-shake.
 */

// The vendored TS std-lib bundle (lib*.d.ts as a JSON map). The package fetches
// it from `getTsLibUrl()` in the browser; point that at the Vite-served asset URL
// (D-004: no hardcoded URL — the bootstrap global is the published seam). MUST be
// set BEFORE the package entry's lazy `loadLibDts` runs (first `ts:init`); setting
// it at module top, before importing the entry, satisfies that ordering.
import tsLibBundleUrl from '@riftydev/ts-language-service/vendor/lib-bundle.json?url';

(globalThis as unknown as { __RIFTY_TS_LIB_URL?: string }).__RIFTY_TS_LIB_URL = tsLibBundleUrl;

import { bootTsLanguageServiceWorker } from '@riftydev/ts-language-service/worker/entry';

// The bottom-of-module auto-boot already ran on import (worker realm + sync API).
// Reference the binding so the import is never tree-shaken; the auto-boot is the
// real boot. Do NOT call it again — a second boot would double-register the
// fork-IPC 'message' listener (each request answered twice).
void bootTsLanguageServiceWorker;
