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
import { type ParityCase, caseCwd } from './types.ts';

// `runInNode` and `runInRifty` execute concurrently. `tty-resize` temporarily
// installs rifty's process on the shared harness global, so retain the genuine
// host object before either run starts.
const HOST_PROCESS = process;

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

const TTY_RESULT_MARKER = '__RIFTY_TTY_RESULT__';

/**
 * Preamble for `kind: 'tty-resize'`. `script` gives this process real TTY
 * descriptors; `stty` is therefore the external terminal driver, not a JS
 * approximation of Node's resize semantics. Initialising the grid before the
 * case reads `process.stdout` makes Node's lazy `tty.WriteStream` start at the
 * same 80x24 seed as the rifty process spec.
 */
const TTY_RESIZE_NODE_PREAMBLE = `
'use strict';
{
  const { execFileSync: __execFileSync } = require('node:child_process');
  const __setTtySize = (cols, rows) => {
    __execFileSync('stty', ['cols', String(cols), 'rows', String(rows)], {
      stdio: ['inherit', 'ignore', 'inherit'],
    });
  };
  __setTtySize(80, 24);
  globalThis.__riftyTtyResize = __setTtySize;
}
`;

/** Absolute path to the workspace-vendored `tsx` CLI (the full-TS-transform runner). */
const TSX_CLI = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url));

function quotePosixShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/**
 * Choose the executable + argv to run a case entry in Node.
 *
 * - Non-`ts-esm`: spawn `process.execPath` directly on the `.js`/`.mjs` entry.
 * - `ts-esm`: spawn the vendored `tsx` CLI on the `.ts` entry — a FULL TS
 *   transform, matching the rifty side's esbuild hook (also a full transform).
 *
 *   We deliberately do NOT use Node's built-in `--experimental-strip-types`
 *   (default on v24): that is *strip-only* and throws
 *   `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on any TS that needs runtime codegen —
 *   `enum`, parameter properties, runtime `namespace`. The gold cross-file
 *   parity case (F02-T7) exports an `enum`, exactly the construct ADR-0052
 *   Spike A validated rifty lowers; pinning the Node reference to a full
 *   transform keeps the comparison apples-to-apples (full transform vs full
 *   transform) instead of diverging on a Node strip-only *limitation* rather
 *   than a rifty behaviour (ADR-0132).
 */
function nodeRunnerFor(testCase: ParityCase, entry: string): [string, string[]] {
  if (testCase.kind === 'ts-esm') {
    return [TSX_CLI, [entry]];
  }
  if (testCase.kind === 'tty-resize') {
    if (testCase.stdin) {
      throw new Error("ParityCase kind 'tty-resize' does not support injected stdin");
    }
    if (HOST_PROCESS.platform === 'linux') {
      // util-linux `script`: command is one POSIX-shell string. Quote the two
      // harness-owned paths as arguments; case source never enters the shell.
      return [
        'script',
        [
          '-q',
          '-e',
          '-c',
          `exec ${quotePosixShellArg(HOST_PROCESS.execPath)} ${quotePosixShellArg(entry)}`,
          '/dev/null',
        ],
      ];
    }
    if (
      HOST_PROCESS.platform === 'darwin' ||
      HOST_PROCESS.platform === 'freebsd' ||
      HOST_PROCESS.platform === 'openbsd' ||
      HOST_PROCESS.platform === 'netbsd'
    ) {
      // BSD `script`: file first, followed by command argv (no shell quoting).
      return ['script', ['-q', '/dev/null', HOST_PROCESS.execPath, entry]];
    }
    throw new Error(
      `ParityCase kind 'tty-resize' needs a POSIX script(1)+stty(1) oracle; unsupported platform ${HOST_PROCESS.platform}`,
    );
  }
  return [HOST_PROCESS.execPath, [entry]];
}

/** Keep only the explicit result record; PTY transcripts may contain CRLF and BSD `script` EOF echo. */
function extractTtyResult(transcript: string): string {
  const records = transcript.split(/\r?\n/u).flatMap((line) => {
    const marker = line.indexOf(TTY_RESULT_MARKER);
    return marker === -1 ? [] : [line.slice(marker)];
  });
  if (records.length !== 1) {
    throw new Error(
      `TTY parity case must print exactly one ${TTY_RESULT_MARKER} record; found ${records.length}: ${JSON.stringify(transcript)}`,
    );
  }
  return `${records[0]}\n`;
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
      testCase.kind === 'http'
        ? `${HTTP_NODE_PREAMBLE}\n${testCase.code}`
        : testCase.kind === 'tty-resize'
          ? `${TTY_RESIZE_NODE_PREAMBLE}\n${testCase.code}`
          : testCase.code;
    await writeFile(entry, source, 'utf8');

    // `ts-esm`: mark the entry dir as a `type:module` scope so Node parses the
    // stripped `.ts` as ESM (matching the rifty side, which mounts the same
    // `/work/package.json`). A setup-provided package.json wins; otherwise the
    // harness supplies the minimal `{ "type": "module" }`.
    if (testCase.kind === 'ts-esm' && !testCase.setup?.files?.['package.json']) {
      await writeFile(join(entryDir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');
    }

    // `ts-esm`: run the `.ts` entry through a FULL TS transform (vendored `tsx`)
    // so codegen-requiring TS (`enum`, parameter properties) lowers the same way
    // rifty's esbuild hook lowers it. Node's built-in strip-only mode would
    // throw `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on those (see `nodeRunnerFor`).
    const [runner, runnerArgs] = nodeRunnerFor(testCase, entry);

    // Per-case cwd (ParityCase.cwd): the child runs at `<workDir>/<cwd>` so
    // relative fs paths anchor exactly where the rifty side's setProcessCwd
    // anchors them. Created even without setup files inside it.
    const childCwd = join(workDir, ...caseCwd(testCase).split('/').filter(Boolean));
    await mkdir(childCwd, { recursive: true });

    return await new Promise<string>((resolve, reject) => {
      const proc = spawn(runner, runnerArgs, {
        cwd: childCwd,
        stdio: [testCase.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let err = '';
      proc.stdout!.on('data', (c) => {
        out += c.toString('utf8');
      });
      proc.stderr!.on('data', (c) => {
        err += c.toString('utf8');
      });
      proc.on('close', (code) => {
        if (code !== 0) reject(new Error(`Node exited ${code}: ${err.trim() || out.trim()}`));
        else {
          try {
            resolve(testCase.kind === 'tty-resize' ? extractTtyResult(out) : out);
          } catch (error) {
            reject(error);
          }
        }
      });
      proc.on('error', reject);
      if (testCase.stdin && proc.stdin) {
        for (const chunk of testCase.stdin) proc.stdin.write(chunk);
        proc.stdin.end();
      }
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
    await rm(entryDir, { recursive: true, force: true });
  }
}
