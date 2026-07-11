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
import { installRuntimeJsFsHandlers } from '@riftydev/runtime-js';
import { getNodeEntryWorkerUrl } from '@riftydev/runtime-js/builtins/node-entry-url';
import { installRuntimeJsExecSyncHandler } from '@riftydev/runtime-js/ipc/exec-sync-handler';
import { syncMirror } from '@riftydev/vfs';
import {
  playgroundNodeWorkerRuntimeEnv,
  resolvePlaygroundWorkbenchConfig,
} from './glue/workbench-host-config.ts';

const dec = new TextDecoder();

/** Child writing raw non-UTF-8 bytes (0xff 0xfe 0x00). A correct v2 binary frame
 *  carries them byte-exact → hex 'fffe00'; a broken frame mangles to U+FFFD →
 *  'efbfbd...'. ADR-0137: the child now runs through the node-entry bootstrap
 *  (`kind:'url'` + RIFTY_REMOTE_FS), so it has a Buffer global — but Uint8Array
 *  keeps the byte-exact write unambiguous. */
const CHILD_BINARY_SCRIPT = 'globalThis.process.stdout.write(new Uint8Array([0xff, 0xfe, 0x00]));';

/** Child writing a plain ASCII marker — proves the blocking round-trip returns
 *  the child's captured stdout. */
const CHILD_BLOCKED_SCRIPT =
  'globalThis.process.stdout.write(`blocked-result:${globalThis.process.env.PARENT_VALUE}:${globalThis.process.cwd()}`);';

/** Explicit user env replaces inherited user values while host bootstrap config survives. */
const CHILD_EXPLICIT_ENV_SCRIPT =
  "globalThis.process.stdout.write(globalThis.process.env.USER_VALUE ?? 'missing');";

// ADR-0137 acceptance — `execSync('node /scripts/build.js')` where build.js (a)
// starts with a `#!` shebang (must be STRIPPED — not a SyntaxError, not echoed),
// (b) does a relative `import './config.js'` (must RESOLVE against the owner
// store), and (c) does `fs.readFileSync('./pkg.json')` (must READ the owner
// store, not an empty realm mirror → ENOENT). The child runs through the
// node-entry bootstrap reading the page (owner) mirror over `fs.*` sync-RPC.
const ACCEPTANCE_BUILD_SCRIPT = `#!/usr/bin/env node
import { tag } from './config.js';
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('./pkg.json', import.meta.url), 'utf8'));
globalThis.process.stdout.write(\`\${tag}:\${pkg.name}\`);
`;
const ACCEPTANCE_CONFIG_SCRIPT = "export const tag = 'built';\n";
const ACCEPTANCE_PKG_JSON = '{"name":"demo-pkg"}';
// `type:module` scope so the `.js` entry + `config.js` are ESM (the real
// workspace shape; a `.js` outside a module scope is CJS and a top-level
// `import` is a parse error — the loader's `detectKind`).
const ACCEPTANCE_PACKAGE_JSON = '{"type":"module"}';

interface HarnessResult {
  readonly status: 'pass' | 'fail';
  readonly hex: string;
  readonly blocked: string;
  readonly explicitEnv: string;
  /** ADR-0137 loader acceptance result (`built:demo-pkg`), or '' on miss. */
  readonly loader: string;
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
  root.appendChild(mk('execsync-explicit-env', 'explicit-env', result.explicitEnv));
  root.appendChild(mk('execsync-loader', 'loader', result.loader));
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
    // ADR-0137: the recursive `execSync` child now spawns a node-entry `kind:'url'`
    // child (shebang strip + relative imports), so the page realm must have the
    // node-entry bootstrap URL wired (main.tsx setNodeEntryWorkerUrl).
    const nodeEntryWorkerUrl = getNodeEntryWorkerUrl();
    if (nodeEntryWorkerUrl === null) {
      throw new Error(
        'getNodeEntryWorkerUrl() is null — main.tsx must call setNodeEntryWorkerUrl first',
      );
    }
    const host = resolvePlaygroundWorkbenchConfig();
    const nodeRuntimeEnv = playgroundNodeWorkerRuntimeEnv(host.assets);

    // Seed the child scripts into the PAGE mirror — the execSync child reads them
    // from this (owner) mirror over `fs.*` sync-RPC. `/scripts/build.js` is the
    // ADR-0137 acceptance entry (shebang + relative import + sibling readFileSync).
    const mirror = syncMirror();
    const enc = new TextEncoder();
    mirror.writeFileSync('/child.js', enc.encode(CHILD_BINARY_SCRIPT));
    mirror.writeFileSync('/blocked.js', enc.encode(CHILD_BLOCKED_SCRIPT));
    mirror.writeFileSync('/explicit-env.js', enc.encode(CHILD_EXPLICIT_ENV_SCRIPT));
    mirror.mkdirSync('/scripts', { recursive: true });
    mirror.writeFileSync('/scripts/package.json', enc.encode(ACCEPTANCE_PACKAGE_JSON));
    mirror.writeFileSync('/scripts/build.js', enc.encode(ACCEPTANCE_BUILD_SCRIPT));
    mirror.writeFileSync('/scripts/config.js', enc.encode(ACCEPTANCE_CONFIG_SCRIPT));
    mirror.writeFileSync('/scripts/pkg.json', enc.encode(ACCEPTANCE_PKG_JSON));

    // The execSync child (a node-entry `kind:'url'` worker, RIFTY_REMOTE_FS=1)
    // reads its entry + relative imports + sibling files from the PAGE (owner)
    // mirror over `fs.*` sync-RPC — so the page dispatcher must serve `fs.*`
    // (ADR-0150). Without this, the child reads its own empty realm mirror →
    // ENOENT. This is the owner's role the real workspace owner plays.
    installRuntimeJsFsHandlers(getKernelDispatcher(), () => mirror);

    // Register the runtime-js 'execSync' handler on the PAGE dispatcher. Resolver
    // is an ENOENT pre-check over the page mirror; null for a missing script →
    // the handler surfaces a proper ENOENT (matches the runtime-js builtin's own
    // resolver). The runner (default makeRecursiveRunner) reads the real source
    // through the node-entry child + module loader.
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
          PARENT_VALUE: 'inherited',
          // The package-owned node bootstrap validates its full host-owned
          // runtime config before user code. execSync inherits this guest env,
          // matching Node's omitted-options behavior, so every nested node
          // worker receives the actual Vite-resolved assets.
          ...nodeRuntimeEnv,
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
    const explicitEnv = matchLine(stdout, 'EXPLICIT_ENV');
    const loader = matchLine(stdout, 'LOADER');
    const guestErr = matchLine(stdout, 'ERROR');

    const ok =
      exitCode === 0 &&
      hex === 'fffe00' &&
      blocked === 'blocked-result:inherited:/' &&
      explicitEnv === 'explicit' &&
      loader === 'built:demo-pkg';
    paint({
      status: ok ? 'pass' : 'fail',
      hex,
      blocked,
      explicitEnv,
      loader,
      detail: ok
        ? 'real SAB + Atomics.waitAsync + v2 binary frame + node-entry loader round-trip'
        : `exit=${exitCode} guestErr=${guestErr} stderr=${stderr.trim().slice(0, 400)}`,
    });
  } catch (err) {
    paint({
      status: 'fail',
      hex: '',
      blocked: '',
      explicitEnv: '',
      loader: '',
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
