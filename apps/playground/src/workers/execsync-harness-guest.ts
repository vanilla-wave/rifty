/// <reference lib="webworker" />

/**
 * execSync e2e harness — GUEST entry (runs in a kernel-spawned Worker realm).
 *
 * The honest end-to-end path that Node tests cannot exercise (no real
 * SharedArrayBuffer + `Atomics.waitAsync` + ADR-0084 v2 binary frame):
 * a guest inside a kernel-spawned Worker calls `execSync` synchronously, which
 * publishes a request into the SAB ring and `Atomics.wait`s; the PAGE realm's
 * dispatcher wakes, runs the runtime-js `'execSync'` handler (spawns a recursive
 * child Worker), and writes the child's stdout BYTES back on a v2 binary frame.
 *
 * Loaded by the kernel-worker bootstrap via `import(spec.entry.url)` once the
 * `WorkerInitMessage` lands. By then `globalThis.process` is the Node-shape shim
 * (kernel pre-entry hook) and `process.env` carries the env the page put on the
 * spawn spec.
 *
 * Two assertions, both written to guest stdout (the page reads them off
 * `handle.stdout()`):
 *   1. `BLOCKED=<text>` — a plain `execSync('node /blocked.js')` proving the
 *      blocking round-trip returns the child's stdout.
 *   2. `HEX=<hex>` — `execSync('node /child.js')` where the child writes raw
 *      non-UTF-8 bytes (0xff 0xfe 0x00). `out.toString('hex')` must be
 *      `fffe00`. A broken v2 frame mangles to U+FFFD → `efbfbd...`; a broken
 *      dispatcher hangs → the page times out. Only the real SAB + v2-frame path
 *      yields `fffe00`.
 *
 * The child scripts are seeded into the PAGE realm's sync mirror by the page
 * harness (the execSync handler's resolver reads the page mirror — same
 * source-of-truth split as the conformance test, where the parent realm writes
 * the script and the parent resolver reads it). This guest only drives the real
 * blocking `execSync` and reports the byte-exact result.
 *
 * This module is e2e-only: it is referenced solely from `execsync-harness.ts`,
 * which `main.tsx` runs only when `location.hash` selects the harness.
 */

import { getKernelWorkerUrl, isSabIpcSupported, setKernelWorkerUrl } from '@riftydev/kernel';
// Deep import is legal here: the playground is the host (top of the layer
// stack), so it may reach runtime-js. `child_process` is the REAL builtin —
// `execSync` is the exact code path `require('node:child_process').execSync`
// runs (the SAB-vs-throw gate in `child_process-sync.ts`).
import { execSync } from '@riftydev/runtime-js/builtins/child_process';

function emit(line: string): void {
  globalThis.process.stdout.write(`${line}\n`);
}

/** Lowercase hex of raw bytes — byte-exact, no TextDecoder (which would mangle
 *  non-UTF-8 to U+FFFD and defeat the whole point of this harness). */
function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

function fail(reason: string): never {
  emit(`ERROR=${reason}`);
  throw new Error(reason);
}

// The execSync gate (child_process-sync.ts) also requires
// `getKernelWorkerUrl() !== null` in THIS realm as a "kernel-managed realm"
// capability check. The page sets it only on the page realm; a fresh spawned
// worker has it null, so the page forwards the real kernel-worker URL via env
// and the guest re-publishes it here. The URL value is used ONLY for the gate:
// the recursive child is spawned by the PAGE realm's dispatcher, never here.
const kernelWorkerUrl = globalThis.process.env.RIFTY_EXECSYNC_KERNEL_WORKER_URL;
if (!kernelWorkerUrl) {
  fail('missing RIFTY_EXECSYNC_KERNEL_WORKER_URL env');
}
if (getKernelWorkerUrl() === null) {
  setKernelWorkerUrl(kernelWorkerUrl);
}

if (!isSabIpcSupported()) {
  fail('isSabIpcSupported() is false in the guest realm (no SAB / COI?)');
}

// 1. Blocking round-trip with a plain ASCII result. Proves the SAB call blocks
//    this realm and returns the child's captured stdout.
const blocked = execSync('node blocked.js');
emit(`BLOCKED=${new TextDecoder().decode(blocked)}`);

// Explicit user env replacement must not erase host-only bootstrap config: the
// nested package node worker still boots, while the user-visible value is the
// explicit one (not the parent's environment).
const explicitEnv = execSync('node /explicit-env.js', { env: { USER_VALUE: 'explicit' } });
emit(`EXPLICIT_ENV=${new TextDecoder().decode(explicitEnv)}`);

// 2. The load-bearing assertion: non-UTF-8 bytes survive the v2 binary frame
//    byte-exact. `child.js` writes [0xff,0xfe,0x00]; a correct round-trip yields
//    hex 'fffe00' (computed from raw bytes — no TextDecoder, which would mangle).
const out = execSync('node /child.js');
emit(`HEX=${toHex(out)}`);

// 3. ADR-0137 acceptance: the recursive child runs through the node-entry
//    bootstrap + module loader. `/scripts/build.js` starts with a `#!` shebang
//    (stripped, not a SyntaxError), does a relative `import './config.js'`
//    (resolved against the owner store over fs.* RPC), and reads `./pkg.json`
//    via `fs.readFileSync` (the owner store, not an empty mirror). Result is
//    `built:demo-pkg`. The OLD raw `kind:'source'` path threw on the shebang,
//    could not resolve the import, and read an empty mirror — this is the gap.
const built = execSync('node /scripts/build.js');
emit(`LOADER=${new TextDecoder().decode(built)}`);

emit('DONE');
