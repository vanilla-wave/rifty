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
 * is non-null AND the kernel control channel is published — exactly
 * the two preconditions the package entry's auto-boot guard checks.
 *
 * This wrapper only forwards to the package's boot. Importing
 * `@riftydev/ts-language-service/worker/entry` runs its bottom-of-module auto-boot
 * (worker realm + sync API present) which builds the FsSync over the owner's fs.*
 * RPC, the createTsLanguageService, and serves the `rifty:ts-lsp` protocol over
 * kernel control.
 *
 * The package's `sideEffects` only whitelists the BUILT `dist/worker/entry.js`;
 * in dev/prod workspace builds Vite resolves the subpath to `src/worker/entry.ts`,
 * which Rollup can treat as side-effect-free and elide. Mirror
 * `kernel-worker-entry.ts`: call the named export explicitly so the emitted worker
 * chunk MUST retain the real endpoint. The package boot is idempotent, so this is
 * safe if the guarded bottom-of-module auto-boot already ran.
 */

// The vendored TS std-lib bundle (lib*.d.ts as a JSON map). The package fetches
// it from `getTsLibUrl()` in the browser; point that at the Vite-served asset URL
// (D-004: no hardcoded URL — the bootstrap global is the published seam). MUST be
// set BEFORE the package entry's lazy `loadLibDts` runs (first `ts:init`).
import tsLibBundleUrl from '@riftydev/ts-language-service/vendor/lib-bundle.json?url';
import { bootTsLanguageServiceWorker } from '@riftydev/ts-language-service/worker/entry';
import { installBundleLocalBuffer } from './worker-runtime-globals.ts';

// Realign globalThis.Buffer to THIS worker bundle's copy. In a PROD build every
// ?worker&url child is self-contained and carries its own @riftydev/io `Buffer`;
// the kernel pre-entry hook set the global to the kernel-worker-entry bundle's
// copy, so the engine's fs.* sync-RPC decode (`require('buffer')`) and the global
// would disagree (instanceof/etag) — the dual-copy crash #73 fixed for the other
// kind:url children. Every kind:url child must reinstall before booting code that
// can touch Buffer.
installBundleLocalBuffer();

(globalThis as unknown as { __RIFTY_TS_LIB_URL?: string }).__RIFTY_TS_LIB_URL = tsLibBundleUrl;

bootTsLanguageServiceWorker();
