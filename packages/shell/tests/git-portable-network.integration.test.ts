/** Real terminal clone/pull path-policy proof over git-http-backend. */
import { Buffer } from 'node:buffer';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeGit, vfsToGitFs } from '@riftydev/git';
import { createHttpServer } from '@riftydev/net';
import { type VfsMutationGuard, type VfsMutationIntent, asyncVfs } from '@riftydev/vfs';
import { installMemoryFs, resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { Shell } from '../src/index.ts';

const ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'rifty',
  GIT_AUTHOR_EMAIL: 'rifty@localhost',
  GIT_AUTHOR_DATE: '1600000000',
  GIT_COMMITTER_NAME: 'rifty',
  GIT_COMMITTER_EMAIL: 'rifty@localhost',
  GIT_COMMITTER_DATE: '1600000000',
};
const HOST_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_AUTHOR_DATE: '1600000000 +0000',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 't@example.com',
  GIT_COMMITTER_DATE: '1600000000 +0000',
  LC_ALL: 'C',
};
const CLAIM = 'node_modules/.rifty-install-stamp.json';

function gitHttpBackendAvailable(): boolean {
  try {
    const execPath = execFileSync('git', ['--exec-path']).toString().trim();
    return existsSync(join(execPath, 'git-http-backend'));
  } catch {
    return false;
  }
}

const AVAILABLE = gitHttpBackendAvailable();
if (!AVAILABLE) console.warn('[shell git integration] SKIPPED: git-http-backend unavailable');

type VirtualServer = ReturnType<typeof createHttpServer>;

/** Bridge rifty's in-process HTTP namespace to the real Git CGI. */
function startGitServer(projectRoot: string): Promise<{ server: VirtualServer; port: number }> {
  const server = createHttpServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: unknown) => {
      if (typeof chunk === 'string' || chunk instanceof Uint8Array) {
        chunks.push(Buffer.from(chunk));
      }
    });
    req.on('error', () => {
      res.statusCode = 500;
      res.end();
    });
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      const body = Buffer.concat(chunks);
      const cgi = spawn('git', ['http-backend'], {
        env: {
          ...process.env,
          GIT_PROJECT_ROOT: projectRoot,
          GIT_HTTP_EXPORT_ALL: '1',
          PATH_INFO: url.pathname,
          QUERY_STRING: url.searchParams.toString(),
          REQUEST_METHOD: req.method,
          CONTENT_TYPE: req.headers['content-type'] ?? '',
          CONTENT_LENGTH: String(body.byteLength),
          GIT_PROTOCOL: req.headers['git-protocol'] ?? '',
        },
      });
      cgi.stdin.end(body);

      let buffered = Buffer.alloc(0);
      let parsed = false;
      cgi.stdout.on('data', (chunk: Buffer) => {
        if (parsed) {
          res.write(chunk);
          return;
        }
        buffered = Buffer.concat([buffered, chunk]);
        const crlf = buffered.indexOf('\r\n\r\n');
        const lf = crlf === -1 ? buffered.indexOf('\n\n') : -1;
        const separator = crlf === -1 ? lf : crlf;
        if (separator === -1) return;
        const separatorLength = crlf === -1 ? 2 : 4;
        const head = buffered.subarray(0, separator).toString('utf8');
        const responseBody = buffered.subarray(separator + separatorLength);
        for (const line of head.split(/\r?\n/)) {
          const colon = line.indexOf(':');
          if (colon === -1) continue;
          const name = line.slice(0, colon);
          const value = line.slice(colon + 1).trim();
          if (name.toLowerCase() === 'status') {
            res.statusCode = Number.parseInt(value, 10) || 200;
          } else {
            res.setHeader(name, value);
          }
        }
        parsed = true;
        if (responseBody.byteLength > 0) res.write(responseBody);
      });
      cgi.stdout.on('end', () => res.end());
      cgi.on('error', () => {
        res.statusCode = 500;
        res.end();
      });
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => {
      server.off('error', reject);
      const port = server.address()?.port;
      if (port === undefined) {
        reject(new Error('virtual HTTP server did not bind'));
        return;
      }
      resolve({ server, port });
    });
  });
}

function rejectClaim(calls: string[][]): (paths: readonly string[]) => void {
  return (paths) => {
    calls.push([...paths]);
    const claim = paths.find((path) => path.endsWith(`/${CLAIM}`));
    if (claim !== undefined) {
      throw Object.assign(new Error(`EPERM: reserved install claim, '${claim}'`), {
        code: 'EPERM',
      });
    }
  };
}

afterEach(() => resetSyncMirror());

describe.skipIf(!AVAILABLE)('terminal Git real smart-HTTP portable preflight', () => {
  it('keeps pull and clone worktrees atomic when a fetched tree contains a reserved claim', async () => {
    const hostRoot = mkdtempSync(join(tmpdir(), 'rifty-shell-git-srv-'));
    const work = join(hostRoot, 'work');
    mkdirSync(work);
    execFileSync('git', ['init', '--bare', '-b', 'main', 'guarded.git'], {
      cwd: hostRoot,
      env: HOST_ENV,
    });
    execFileSync('git', ['init', '-b', 'main'], { cwd: work, env: HOST_ENV });
    writeFileSync(join(work, 'a.txt'), 'initial\n');
    execFileSync('git', ['add', 'a.txt'], { cwd: work, env: HOST_ENV });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: work, env: HOST_ENV });
    execFileSync('git', ['remote', 'add', 'origin', join(hostRoot, 'guarded.git')], {
      cwd: work,
      env: HOST_ENV,
    });
    execFileSync('git', ['push', 'origin', 'main'], { cwd: work, env: HOST_ENV });

    const { server, port } = await startGitServer(hostRoot);
    try {
      installMemoryFs();
      const vfs = asyncVfs();
      if (!vfs) throw new Error('no async vfs');
      await vfs.mkdir('/workspace', { recursive: true });
      const url = `http://localhost:${port}/guarded.git`;
      const setup = new Shell({ cwd: '/workspace', env: ENV });
      const initialClone = await setup.run(`git clone ${url} repo`);
      expect(initialClone.exitCode, initialClone.stderr).toBe(0);

      writeFileSync(join(work, 'a.txt'), 'remote\n');
      mkdirSync(join(work, 'node_modules'));
      writeFileSync(join(work, CLAIM), 'foreign claim\n');
      execFileSync('git', ['add', '-f', 'a.txt', CLAIM], { cwd: work, env: HOST_ENV });
      execFileSync('git', ['commit', '-m', 'guarded'], { cwd: work, env: HOST_ENV });
      execFileSync('git', ['push', 'origin', 'main'], { cwd: work, env: HOST_ENV });

      const local = makeGit({ fs: vfsToGitFs(vfs), dir: '/workspace/repo' });
      const head = await local.resolveRef('HEAD');
      const status = await local.status();
      const index = await vfs.readFile('/workspace/repo/.git/index');
      const pullCalls: string[][] = [];
      const pullBatches: VfsMutationIntent[][] = [];
      const pullGuard: VfsMutationGuard = async (intents, apply) => {
        pullBatches.push([...intents]);
        return await apply();
      };
      const pulling = new Shell({
        cwd: '/workspace/repo',
        env: ENV,
        mutationGuard: pullGuard,
        assertPortablePaths: rejectClaim(pullCalls),
      });

      const pull = await pulling.run('git pull origin main');

      expect(pull.exitCode).toBe(128);
      expect(pull.stderr).toContain('EPERM');
      expect(pullCalls).toEqual([['/workspace/repo/a.txt', `/workspace/repo/${CLAIM}`]]);
      expect(pullBatches).toEqual([
        [
          { kind: 'write', path: '/workspace/repo/.git' },
          { kind: 'replace', path: '/workspace/repo' },
        ],
      ]);
      expect(await vfs.readFileText('/workspace/repo/a.txt')).toBe('initial\n');
      expect(await vfs.exists(`/workspace/repo/${CLAIM}`)).toBe(false);
      expect(await local.resolveRef('HEAD')).toBe(head);
      expect(await local.status()).toEqual(status);
      expect(await vfs.readFile('/workspace/repo/.git/index')).toEqual(index);

      const cloneCalls: string[][] = [];
      const cloneBatches: VfsMutationIntent[][] = [];
      const cloneGuard: VfsMutationGuard = async (intents, apply) => {
        cloneBatches.push([...intents]);
        return await apply();
      };
      const cloning = new Shell({
        cwd: '/workspace',
        env: ENV,
        mutationGuard: cloneGuard,
        assertPortablePaths: rejectClaim(cloneCalls),
      });

      const clone = await cloning.run(`git clone ${url} rejected`);

      expect(clone.exitCode).toBe(128);
      expect(clone.stderr).toContain('EPERM');
      expect(cloneCalls).toEqual([['/workspace/rejected/a.txt', `/workspace/rejected/${CLAIM}`]]);
      expect(cloneBatches).toEqual([[{ kind: 'write', path: '/workspace/rejected' }]]);
      expect(await vfs.exists('/workspace/rejected/a.txt')).toBe(false);
      expect(await vfs.exists(`/workspace/rejected/${CLAIM}`)).toBe(false);
      expect(await vfs.exists('/workspace/rejected/.git')).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(hostRoot, { recursive: true, force: true });
    }
  });
});
