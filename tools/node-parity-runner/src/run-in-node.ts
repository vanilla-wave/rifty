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

// Rifty process modes temporarily replace the shared harness global. Keep the
// genuine host process for native runner selection and platform checks.
const HOST_PROCESS = process;
const HOST_SET_TIMEOUT = globalThis.setTimeout.bind(globalThis);
const HOST_CLEAR_TIMEOUT = globalThis.clearTimeout.bind(globalThis);
const DEFAULT_CASE_TIMEOUT_MS = 30_000;
const KILL_CLOSE_GRACE_MS = 1_000;

export interface RunInNodeOptions {
  readonly timeoutMs?: number;
}

function caseTimeoutMs(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(
      `RunInNodeOptions.timeoutMs must be a positive safe integer; received ${value}`,
    );
  }
  return value;
}

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
      return ['script', ['-q', '/dev/null', HOST_PROCESS.execPath, entry]];
    }
    throw new Error(
      `ParityCase kind 'tty-resize' needs POSIX script(1)+stty(1); unsupported platform ${HOST_PROCESS.platform}`,
    );
  }
  return [HOST_PROCESS.execPath, [entry]];
}

/** Discard PTY transcript/CRLF noise and retain the case's single explicit record. */
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

export async function runInNode(
  testCase: ParityCase,
  options: RunInNodeOptions = {},
): Promise<string> {
  const timeoutMs = caseTimeoutMs(options.timeoutMs ?? DEFAULT_CASE_TIMEOUT_MS);
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
      let settled = false;
      let timeoutError: Error | undefined;
      const timers: {
        caseTimeout?: ReturnType<typeof setTimeout>;
        killClose?: ReturnType<typeof setTimeout>;
      } = {};
      const clearTimers = (): void => {
        if (timers.caseTimeout !== undefined) HOST_CLEAR_TIMEOUT(timers.caseTimeout);
        if (timers.killClose !== undefined) HOST_CLEAR_TIMEOUT(timers.killClose);
      };
      const rejectOnce = (error: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimers();
        reject(error);
      };
      const resolveOnce = (value: string): void => {
        if (settled) return;
        settled = true;
        clearTimers();
        resolve(value);
      };
      proc.stdout!.on('data', (c) => {
        out += c.toString('utf8');
      });
      proc.stderr!.on('data', (c) => {
        err += c.toString('utf8');
      });
      proc.on('close', (code) => {
        if (timeoutError) {
          rejectOnce(timeoutError);
        } else if (code !== 0) {
          rejectOnce(new Error(`Node exited ${code}: ${err.trim() || out.trim()}`));
        } else {
          try {
            resolveOnce(testCase.kind === 'tty-resize' ? extractTtyResult(out) : out);
          } catch (error) {
            rejectOnce(error);
          }
        }
      });
      proc.on('error', (error) => rejectOnce(error));
      if (testCase.stdin && proc.stdin) {
        for (const chunk of testCase.stdin) proc.stdin.write(chunk);
        proc.stdin.end();
      }
      timers.caseTimeout = HOST_SET_TIMEOUT(() => {
        timeoutError = new Error(
          `Node parity case timed out after ${timeoutMs}ms${err.trim() || out.trim() ? `: ${err.trim() || out.trim()}` : ''}`,
        );
        proc.stdin?.destroy();
        try {
          proc.kill('SIGKILL');
        } catch (error) {
          rejectOnce(
            new AggregateError(
              [timeoutError, error],
              'Node parity case timed out and native child termination failed',
            ),
          );
          return;
        }
        // `close` is the normal settlement so temp fixtures are not removed under
        // a still-live child. Bound even a broken host kill/reap path loudly.
        timers.killClose = HOST_SET_TIMEOUT(
          () =>
            rejectOnce(
              new AggregateError(
                [timeoutError!],
                `Node parity child did not close within ${KILL_CLOSE_GRACE_MS}ms after SIGKILL`,
              ),
            ),
          KILL_CLOSE_GRACE_MS,
        );
      }, timeoutMs);
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
    await rm(entryDir, { recursive: true, force: true });
  }
}
