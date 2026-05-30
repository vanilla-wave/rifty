/**
 * Run case code in a child Node process and capture its stdout. Uses a tiny
 * harness so we can preload "VFS" files into a real temp dir before evaluating
 * the user code.
 */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ParityCase } from './types.ts';

/**
 * Preamble injected ahead of a `kind: 'http'` case so the SAME case `code`
 * runs unchanged in real Node. It defines the request-driver global
 * `__riftyHttpRequest(port, path, init?)` over a real `http.request` to
 * `127.0.0.1:<port>` and normalises the response to the same
 * `{ status, statusText, contentType, body }` shape the rifty side returns
 * (see `run-in-rifty.ts`). It also `unref()`s every listening server so the
 * child process exits once the round-trip completes — the case never calls
 * `server.close()`, and a live listening socket would otherwise keep Node's
 * event loop alive forever.
 */
const HTTP_NODE_PREAMBLE = `
'use strict';
{
  const __http = require('node:http');
  const __origListen = __http.Server.prototype.listen;
  __http.Server.prototype.listen = function (...args) {
    const r = __origListen.apply(this, args);
    this.unref();
    return r;
  };
  globalThis.__riftyHttpRequest = function (port, path, init) {
    const method = (init && init.method) || 'GET';
    const headers = (init && init.headers) || {};
    const body = init && init.body;
    return new Promise((resolve, reject) => {
      const req = __http.request(
        { host: '127.0.0.1', port, path, method, headers },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            resolve({
              status: res.statusCode,
              statusText: res.statusMessage,
              contentType: res.headers['content-type'] ?? null,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      if (body != null) req.write(body);
      req.end();
    });
  };
}
`;

/** Major version of the Node running this harness (e.g. `24` for `v24.5.0`). */
const NODE_MAJOR = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);

/** Absolute path to the workspace-vendored `tsx` CLI (the strip-types fallback). */
const TSX_CLI = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url));

/**
 * Choose the executable + argv to run a case entry in Node.
 *
 * - Non-`ts-esm`: spawn `process.execPath` directly on the `.js`/`.mjs` entry.
 * - `ts-esm` on Node >= 23 (types stripped by default): spawn
 *   `process.execPath` on the `.ts` entry — no flag needed.
 * - `ts-esm` on older Node: spawn the vendored `tsx` CLI so the type-strip
 *   still happens, keeping the parity comparison valid off the v24+ matrix.
 */
function nodeRunnerFor(testCase: ParityCase, entry: string): [string, string[]] {
  if (testCase.kind === 'ts-esm' && NODE_MAJOR < 23) {
    return [TSX_CLI, [entry]];
  }
  return [process.execPath, [entry]];
}

export async function runInNode(testCase: ParityCase): Promise<string> {
  // `workDir` is the case's cwd — it holds setup files so `fs.readdirSync('.')`
  // sees only the case's fixtures (no harness scaffolding). `entryDir` holds
  // a COPY of those same setup files PLUS the entry script, so a case calling
  // `require('./a.js')` from `main.js` resolves to a real sibling on disk.
  // This mirrors the rifty harness, which mounts setup files at `/work/<rel>`
  // alongside the entry at `/work/main.{js,mjs}` for the loader, while the
  // fs sync-mirror exposes them at `/<rel>` for `fs.*Sync` parity with the
  // Node-side cwd view.
  const workDir = await mkdtemp(join(tmpdir(), 'rifty-parity-'));
  const entryDir = `${workDir}-entry`;
  try {
    if (testCase.setup?.files) {
      for (const [rel, content] of Object.entries(testCase.setup.files)) {
        const inCwd = join(workDir, rel);
        await mkdir(dirname(inCwd), { recursive: true });
        await writeFile(inCwd, content, 'utf8');
        const inEntry = join(entryDir, rel);
        await mkdir(dirname(inEntry), { recursive: true });
        await writeFile(inEntry, content, 'utf8');
      }
    } else {
      await mkdir(entryDir, { recursive: true });
    }
    const ext = testCase.kind === 'esm' ? 'mjs' : testCase.kind === 'ts-esm' ? 'ts' : 'js';
    const entry = join(entryDir, `main.${ext}`);
    // For the opt-in http mode, prepend the request-driver preamble so the case
    // can call `__riftyHttpRequest` under real Node exactly as it does in rifty.
    const source =
      testCase.kind === 'http' ? `${HTTP_NODE_PREAMBLE}\n${testCase.code}` : testCase.code;
    await writeFile(entry, source, 'utf8');

    // `ts-esm`: mark the entry dir as a `type:module` scope so Node parses the
    // stripped `.ts` as ESM (matching the rifty side, which mounts the same
    // `/work/package.json`). A setup-provided package.json wins; otherwise the
    // harness supplies the minimal `{ "type": "module" }`.
    if (testCase.kind === 'ts-esm' && !testCase.setup?.files?.['package.json']) {
      await writeFile(join(entryDir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');
    }

    // `ts-esm`: run the `.ts` entry with type-stripping. Node v24 strips types
    // by default, so `process.execPath main.ts` is enough; on older Node we
    // shell out to the vendored `tsx` loader instead. Detecting the major
    // version keeps the harness honest across the CI Node matrix rather than
    // assuming a strip-types-capable runtime.
    const [runner, runnerArgs] = nodeRunnerFor(testCase, entry);

    return await new Promise<string>((resolve, reject) => {
      const proc = spawn(runner, runnerArgs, {
        cwd: workDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let err = '';
      proc.stdout.on('data', (c) => {
        out += c.toString('utf8');
      });
      proc.stderr.on('data', (c) => {
        err += c.toString('utf8');
      });
      proc.on('close', (code) => {
        if (code !== 0) reject(new Error(`Node exited ${code}: ${err.trim() || out.trim()}`));
        else resolve(out);
      });
      proc.on('error', reject);
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
    await rm(entryDir, { recursive: true, force: true });
  }
}
