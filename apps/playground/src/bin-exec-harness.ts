/**
 * node_modules/.bin execution e2e harness — PAGE entry (ADR-0137, Opt-Y).
 *
 * DRAFT / CI-FIRST: proves the `.bin` WORKER TRANSPORT end-to-end in a real
 * cross-origin-isolated chromium Worker — the path node tests can't exercise
 * (real SAB-backed VFS read in the worker + module-loader run of the launcher
 * target). The MECHANISM (`runNodeEntry` + loader + launcher-target resolve) is
 * already proven by node unit tests + parity; this is the transport on top.
 * Authored against the `execsync-sab` pattern but NOT run locally (no COI
 * browser here) — first execution is in CI; treat a first-run failure as a
 * wiring tweak, not a mechanism regression.
 *
 * e2e-gated: `main.tsx` runs this only for `#test=bin-exec`.
 *
 * Flow: full `bootstrapPlayground()` first (so the page serves the worker's VFS
 * sync reads, exactly as the real app does for real-vite's node_modules), then
 * seed a launcher shim + its target into `/workspace/node_modules`, spawn the
 * `kind:'url'` node-entry bootstrap with `RIFTY_BIN=1` (the same spawn
 * `createBinExecutor` builds), read the bin's stdout, and paint a stable testid.
 */

import { globalProcessManager, isSabIpcSupported } from '@riftydev/kernel';
import { syncMirror } from '@riftydev/vfs';
import { bootstrapPlayground } from './boot.ts';
import nodeEntryBootstrapUrl from './workers/node-entry-bootstrap.ts?worker&url';

const dec = new TextDecoder();
const enc = new TextEncoder();

const SHIM_PATH = '/workspace/node_modules/.bin/greet';
// The bin writes a marker + echoes its argv tail, proving both that the
// launcher target ran through the loader and that args reach it.
const FILES: Record<string, string> = {
  '/workspace/node_modules/.bin/greet': "#!/usr/bin/env node\nimport('../greet-pkg/bin.js');\n",
  '/workspace/node_modules/greet-pkg/package.json': JSON.stringify({ name: 'greet-pkg' }),
  '/workspace/node_modules/greet-pkg/bin.js':
    "globalThis.process.stdout.write('GREETED:' + globalThis.process.argv.slice(2).join('|') + '\\n');\n",
};

interface HarnessResult {
  readonly status: 'pass' | 'fail';
  readonly output: string;
  readonly detail: string;
}

function paint(result: HarnessResult): void {
  const root = document.createElement('div');
  root.setAttribute('data-testid', 'bin-exec-harness');
  root.setAttribute('data-status', result.status);
  root.style.cssText = 'padding:24px;font-family:ui-monospace,monospace;font-size:14px;';
  const mk = (testid: string, label: string, value: string): HTMLElement => {
    const el = document.createElement('pre');
    el.setAttribute('data-testid', testid);
    el.style.cssText = 'margin:4px 0;white-space:pre-wrap;';
    el.textContent = `${label}: ${value}`;
    return el;
  };
  root.appendChild(mk('bin-exec-status', 'status', result.status));
  root.appendChild(mk('bin-exec-output', 'output', result.output));
  root.appendChild(mk('bin-exec-detail', 'detail', result.detail));
  document.body.innerHTML = '';
  document.body.appendChild(root);
}

/** Drive the harness; resolves after painting so the spec can read the DOM. */
export async function runBinExecHarness(): Promise<void> {
  try {
    if (!isSabIpcSupported()) {
      throw new Error('isSabIpcSupported() is false — COI/SAB not active on the page realm');
    }
    // Full boot so the page wires the VFS sync backend the worker reads through.
    await bootstrapPlayground();

    const mirror = syncMirror();
    for (const [path, content] of Object.entries(FILES)) {
      mirror.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
      mirror.writeFileSync(path, enc.encode(content));
    }

    // The exact spawn `createBinExecutor` builds (App.tsx): kind:'url' node-entry
    // bootstrap, shim path as argv[1], RIFTY_BIN=1.
    const handle = globalProcessManager.spawnWorker(
      'greet',
      {
        entry: { kind: 'url', url: nodeEntryBootstrapUrl },
        argv: ['rifty', SHIM_PATH, 'a', 'b'],
        env: { RIFTY_BIN: '1' },
        cwd: '/workspace',
      },
      /* ppid */ 1,
      { cwd: '/workspace' },
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

    const output = stdout.trim();
    const ok = exitCode === 0 && output.includes('GREETED:a|b');
    paint({
      status: ok ? 'pass' : 'fail',
      output,
      detail: ok
        ? 'launcher target ran through the module loader in a real COI worker'
        : `exit=${exitCode} stderr=${stderr.trim().slice(0, 400)}`,
    });
  } catch (err) {
    paint({
      status: 'fail',
      output: '',
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
