/**
 * Real smart-HTTP clone integration (Task 4.4). Proves the clone→VFS path is
 * faithful end-to-end over a REAL `git http-backend` CGI served on `node:http`:
 * real refs negotiation, real packfile, real checkout, canonical objects — NO
 * mock of the transport or the http client.
 *
 * Drives OUR facade `makeGit().clone()`. The default rifty http plugin routes
 * loopback `http://localhost:*` through @riftydev/net's in-process port
 * registry (not real TCP), so it can't reach a real localhost server; we
 * therefore INJECT isomorphic-git's `http/node` client (real TCP) via the
 * `http` option. The facade still owns the call (transport guard, corsProxy
 * resolution, mapGitNetworkError) — only the wire client is swapped.
 *
 * Capability-gated: if real git / git-http-backend is unavailable (CI without
 * the binary) the suite SKIPS loudly (console.warn) rather than false-failing.
 * The skip path never masks a real failure — it only triggers when the binary
 * is genuinely missing.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryVfs } from '@riftydev/vfs';
// `nodeHttp`: real-TCP node http client. Different structural shape from
// rifty's GitHttp plugin (it's isomorphic-git's stock client) — cast at the
// test boundary below; the facade only forwards it to git.clone, so the wire
// behaviour is genuine.
import nodeHttp from 'isomorphic-git/http/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { vfsToGitFs } from '../src/fs-adapter.ts';
import { makeGit } from '../src/git.ts';
import type { GitHttp } from '../src/http-plugin.ts';

/** Real git + git-http-backend usable on this host? */
function gitHttpBackendAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
  } catch {
    return false; // no git at all
  }
  try {
    // git-http-backend is a CGI binary that lives in git's exec-path. Its
    // presence as a file is the robust signal: invoking it with no
    // REQUEST_METHOD prints a 500 to stdout but exits 0 on some platforms, so
    // an exit-code probe is unreliable.
    const execPath = execFileSync('git', ['--exec-path']).toString().trim();
    return existsSync(join(execPath, 'git-http-backend'));
  } catch {
    return false;
  }
}

const AVAILABLE = gitHttpBackendAvailable();
if (!AVAILABLE) {
  console.warn('[git integration] SKIPPED: real git/http-backend unavailable');
}

/** Deterministic identity + dates → a stable HEAD sha we can assert exactly. */
const FIXED = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_AUTHOR_DATE: '1600000000 +0000',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 't@example.com',
  GIT_COMMITTER_DATE: '1600000000 +0000',
  LC_ALL: 'C',
};

/**
 * Bridge `node:http` ⇄ `git http-backend` (a CGI). Spawns the CGI per request
 * with the standard GIT_* env, pipes the request body into stdin, and parses
 * the CGI's `Header: value` block (terminated by a blank line) off stdout into
 * real HTTP response headers/status before streaming the rest as the body.
 */
function startGitServer(projectRoot: string): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://localhost');
    const cgi = spawn('git', ['http-backend'], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: projectRoot,
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: u.pathname,
        QUERY_STRING: u.searchParams.toString(),
        REQUEST_METHOD: req.method ?? 'GET',
        CONTENT_TYPE: req.headers['content-type'] ?? '',
        CONTENT_LENGTH: req.headers['content-length'] ?? '',
        GIT_PROTOCOL: (req.headers['git-protocol'] as string) ?? '',
      },
    });
    req.pipe(cgi.stdin);
    let buf = Buffer.alloc(0);
    let parsed = false;
    cgi.stdout.on('data', (c: Buffer) => {
      if (parsed) {
        res.write(c);
        return;
      }
      buf = Buffer.concat([buf, c]);
      const sep = buf.indexOf('\r\n\r\n');
      if (sep === -1) return;
      const head = buf.subarray(0, sep).toString('utf8');
      const body = buf.subarray(sep + 4);
      let status = 200;
      for (const line of head.split('\r\n')) {
        const i = line.indexOf(':');
        if (i === -1) continue;
        const k = line.slice(0, i);
        const v = line.slice(i + 1).trim();
        if (k.toLowerCase() === 'status') status = Number.parseInt(v, 10) || 200;
        else res.setHeader(k, v);
      }
      res.statusCode = status;
      parsed = true;
      if (body.length) res.write(body);
    });
    cgi.stdout.on('end', () => res.end());
    cgi.stderr.on('data', () => {});
    cgi.on('error', () => {
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port });
    }),
  );
}

// Cast nodeHttp to the facade's GitHttp shape at the test boundary — see file
// header. `makeGit` forwards `http` verbatim to git.clone, so the real client
// drives the wire while OUR facade owns the call path.
const HTTP = nodeHttp as unknown as GitHttp;

describe.skipIf(!AVAILABLE)('git smart-HTTP clone integration', () => {
  let server: http.Server;
  let port: number;
  let reposDir: string;
  let workDir: string;
  let expectedSha: string;

  beforeAll(async () => {
    // Bare repo the server will serve.
    reposDir = mkdtempSync(join(tmpdir(), 'rifty-git-srv-'));
    execFileSync('git', ['init', '--bare', 'repo.git'], { cwd: reposDir });

    // Working repo: one deterministic commit, pushed to the bare repo.
    workDir = mkdtempSync(join(tmpdir(), 'rifty-git-work-'));
    const env = { ...process.env, ...FIXED };
    execFileSync('git', ['init', '-b', 'main'], { cwd: workDir, env });
    writeFileSync(join(workDir, 'readme.txt'), 'clone me\n');
    execFileSync('git', ['add', 'readme.txt'], { cwd: workDir, env });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: workDir, env });
    execFileSync('git', ['remote', 'add', 'origin', join(reposDir, 'repo.git')], {
      cwd: workDir,
      env,
    });
    execFileSync('git', ['push', 'origin', 'main'], { cwd: workDir, env });

    // The canonical HEAD sha — end-to-end object fidelity is "the clone's HEAD
    // resolves to exactly this".
    expectedSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workDir, env })
      .toString()
      .trim();

    const started = await startGitServer(reposDir);
    server = started.server;
    port = started.port;
  });

  afterAll(() => {
    server?.close();
    if (reposDir) rmSync(reposDir, { recursive: true, force: true });
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('clones a real smart-HTTP repo into the VFS (canonical objects)', async () => {
    const vfs = new MemoryVfs();
    const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/c', http: HTTP, corsProxy: '' });

    await g.clone({ url: `http://127.0.0.1:${port}/repo.git`, singleBranch: true });

    expect(await vfs.exists('/c/.git')).toBe(true);
    expect(await vfs.readFileText('/c/readme.txt')).toBe('clone me\n');
    // The cloned HEAD must equal the bare repo's HEAD sha bit-for-bit — proves
    // refs negotiation, packfile, and checkout all preserved canonical objects.
    expect(await g.resolveRef('HEAD')).toBe(expectedSha);
  });
});
