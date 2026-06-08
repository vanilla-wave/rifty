/**
 * execSync e2e harness — PAGE entry (runs in the page / dispatcher-owning realm).
 *
 * Proves rifty's real `execSync`-over-SAB path end-to-end in a cross-origin-
 * isolated chromium Worker — the path Node tests cannot exercise (real
 * SharedArrayBuffer + `Atomics.waitAsync` dispatcher wake + ADR-0084 v2 binary
 * frame). It is e2e-gated: `main.tsx` runs this only when `location.hash`
 * selects `#test=execsync`, so normal playground behaviour is untouched.
 *
 * Topology (sync-dispatch.ts §"runs in the realm that owns the kernel"):
 *   - The guest's `execSync` publishes a request into ITS SAB ring and
 *     `Atomics.wait`s. That ring is serviced by the dispatcher in the realm that
 *     called `spawnWorker` — i.e. THIS page realm.
 *   - The playground page never `require`s child_process, so the lazy
 *     first-require handler install (builtins/child_process.ts) never fires
 *     here. We register the runtime-js `'execSync'` handler explicitly on the
 *     page dispatcher (the minimal missing wiring), reusing the public
 *     `installRuntimeJsExecSyncHandler` seam.
 *   - The handler's script resolver reads the PAGE realm's sync mirror, so we
 *     seed the child scripts here (same source-of-truth split as the
 *     conformance test: parent writes the script, parent resolver reads it).
 *
 * The guest then runs two `execSync` calls and emits its results on stdout,
 * which we surface into the DOM with stable testids the spec asserts.
 */

import {
  getKernelDispatcher,
  getKernelWorkerUrl,
  globalProcessManager,
  isSabIpcSupported,
} from '@riftydev/kernel';
import { installRuntimeJsExecSyncHandler } from '@riftydev/runtime-js/ipc/exec-sync-handler';
import { syncMirror } from '@riftydev/vfs';

const dec = new TextDecoder();

/** Child writing raw non-UTF-8 bytes (0xff 0xfe 0x00). A correct v2 binary frame
 *  carries them byte-exact → hex 'fffe00'; a broken frame mangles to U+FFFD →
 *  'efbfbd...'. `Uint8Array` (not Buffer) because a kind:'source' child has no
 *  Buffer global — only the kernel `process` shim. */
const CHILD_BINARY_SCRIPT = 'globalThis.process.stdout.write(new Uint8Array([0xff, 0xfe, 0x00]));';

/** Child writing a plain ASCII marker — proves the blocking round-trip returns
 *  the child's captured stdout. */
const CHILD_BLOCKED_SCRIPT = "globalThis.process.stdout.write('blocked-result');";

interface HarnessResult {
  readonly status: 'pass' | 'fail';
  readonly hex: string;
  readonly blocked: string;
  readonly detail: string;
}

function paint(result: HarnessResult): void {
  const root = document.createElement('div');
  root.setAttribute('data-testid', 'execsync-harness');
  root.setAttribute('data-status', result.status);
  root.style.cssText = 'padding:24px;font-family:ui-monospace,monospace;font-size:14px;';

  const mk = (testid: string, label: string, value: string): HTMLElement => {
    const el = document.createElement('pre');
    el.setAttribute('data-testid', testid);
    el.style.cssText = 'margin:4px 0;white-space:pre-wrap;';
    el.textContent = `${label}: ${value}`;
    return el;
  };

  root.appendChild(mk('execsync-status', 'status', result.status));
  root.appendChild(mk('execsync-hex', 'hex', result.hex));
  root.appendChild(mk('execsync-blocked', 'blocked', result.blocked));
  root.appendChild(mk('execsync-detail', 'detail', result.detail));

  document.body.innerHTML = '';
  document.body.appendChild(root);
}

/**
 * Drive the harness. Resolves after painting the result so the e2e spec can read
 * the DOM. Any throw is caught and painted as a `fail` so the spec sees a
 * deterministic node instead of timing out on an unhandled rejection.
 */
export async function runExecSyncHarness(): Promise<void> {
  try {
    // Page-realm VFS: `syncMirror()` returns the default in-memory mirror on the
    // main thread (no initBackend — OPFS sync is worker-only and would throw
    // here; memory is all the handler resolver needs to serve the seeded scripts).
    if (!isSabIpcSupported()) {
      throw new Error('isSabIpcSupported() is false — COI/SAB not active on the page realm');
    }
    const kernelWorkerUrl = getKernelWorkerUrl();
    if (kernelWorkerUrl === null) {
      throw new Error('getKernelWorkerUrl() is null — main.tsx must call setKernelWorkerUrl first');
    }

    // Seed the child scripts into the PAGE mirror — the handler's resolver reads
    // them here when the guest runs `execSync('node /child.js')`.
    const mirror = syncMirror();
    const enc = new TextEncoder();
    mirror.writeFileSync('/child.js', enc.encode(CHILD_BINARY_SCRIPT));
    mirror.writeFileSync('/blocked.js', enc.encode(CHILD_BLOCKED_SCRIPT));

    // Register the runtime-js 'execSync' handler on the PAGE dispatcher. Resolver
    // reads the page mirror; null for a missing script → the handler surfaces a
    // proper ENOENT (matches the runtime-js builtin's own resolver).
    installRuntimeJsExecSyncHandler(getKernelDispatcher(), (path) => {
      if (!mirror.existsSync(path)) return null;
      return mirror.readFileBytesSync(path);
    });

    // Bundled as its own worker chunk by Vite (string URL form).
    const guestUrl = new URL('./workers/execsync-harness-guest.ts', import.meta.url).toString();

    const handle = globalProcessManager.spawnWorker(
      'execsync-harness-guest',
      {
        entry: { kind: 'url', url: guestUrl },
        argv: ['rifty', 'execsync-harness-guest'],
        env: {
          // Forward the real kernel-worker URL: the guest re-publishes it so its
          // execSync gate (getKernelWorkerUrl() !== null) passes. The value is
          // used only for the gate; the recursive child runs on THIS dispatcher.
          RIFTY_EXECSYNC_KERNEL_WORKER_URL: String(kernelWorkerUrl),
        },
        cwd: '/',
      },
      /* ppid */ 1,
      { cwd: '/' },
    );

    if (handle.kind !== 'worker') {
      throw new Error(`expected a worker-backed handle, got kind=${handle.kind}`);
    }

    let stdout = '';
    let stderr = '';
    handle.stdout().on('data', (chunk: unknown) => {
      stdout += decodeChunk(chunk);
    });
    handle.stderr().on('data', (chunk: unknown) => {
      stderr += decodeChunk(chunk);
    });

    const exitCode = await new Promise<number | null>((resolve) => {
      handle.on('exit', (code: unknown) => resolve(typeof code === 'number' ? code : null));
    });

    const hex = matchLine(stdout, 'HEX');
    const blocked = matchLine(stdout, 'BLOCKED');
    const guestErr = matchLine(stdout, 'ERROR');

    const ok = exitCode === 0 && hex === 'fffe00' && blocked === 'blocked-result';
    paint({
      status: ok ? 'pass' : 'fail',
      hex,
      blocked,
      detail: ok
        ? 'real SAB + Atomics.waitAsync + v2 binary frame round-trip'
        : `exit=${exitCode} guestErr=${guestErr} stderr=${stderr.trim().slice(0, 400)}`,
    });
  } catch (err) {
    paint({
      status: 'fail',
      hex: '',
      blocked: '',
      detail: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
  }
}

function decodeChunk(chunk: unknown): string {
  if (chunk instanceof Uint8Array) return dec.decode(chunk);
  if (ArrayBuffer.isView(chunk)) {
    return dec.decode(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  }
  return typeof chunk === 'string' ? chunk : '';
}

/** Pull the value of a `KEY=value` line out of the guest's stdout. */
function matchLine(text: string, key: string): string {
  for (const line of text.split('\n')) {
    if (line.startsWith(`${key}=`)) return line.slice(key.length + 1);
  }
  return '';
}
