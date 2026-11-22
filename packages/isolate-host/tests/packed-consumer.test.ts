/**
 * I6 consumer install (goal isolate-host-run-code, scenario step 1): the packed
 * tarball installs into a clean Node project by the README steps and runCode
 * works under plain `node` (no flags).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'isolate-host-consumer-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

it('packed tarball installs and runs under plain node', () => {
  const packDir = join(work, 'pack');
  execFileSync('pnpm', ['pack', '--pack-destination', packDir], {
    cwd: PACKAGE_DIR,
    stdio: 'pipe',
  });
  const tarball = readdirSync(packDir).find((f) => f.endsWith('.tgz'));
  expect(tarball).toBeDefined();
  const app = join(work, 'app');
  execFileSync('mkdir', ['-p', app]);
  writeFileSync(
    join(app, 'package.json'),
    JSON.stringify({ name: 'consumer', private: true, type: 'module' }),
  );
  execFileSync('npm', ['install', '--no-audit', '--no-fund', join(packDir, tarball as string)], {
    cwd: app,
    stdio: 'pipe',
  });
  // The README's own install line and usage snippet, not a test-local variant.
  const readme = readFileSync(join(PACKAGE_DIR, 'README.md'), 'utf8');
  expect(readme).toContain(`npm install /path/to/${tarball}`);
  const snippet = /```js\n([\s\S]*?)```/.exec(readme)?.[1];
  expect(snippet).toContain("import { runCode } from '@riftydev/isolate-host';");
  writeFileSync(
    join(app, 'main.js'),
    `${snippet}\nconst root = await import('@riftydev/isolate-host');\nconsole.log(JSON.stringify({ stdout, stderr, exitCode, exports: Object.keys(root) }));\n`,
  );
  const out = execFileSync(process.execPath, ['main.js'], {
    cwd: app,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
  });
  expect(JSON.parse(out)).toEqual({
    stdout: '42\n',
    stderr: '',
    exitCode: 0,
    exports: ['createSandbox', 'runCode'],
  });
}, 240_000);

// RED until the README carries the sandbox snippet and the codec lands.
it.fails(
  'the packed tarball runs the README sandbox snippet (ADR-0568)',
  () => {
    // Reuses the install of the previous case when present; installs otherwise.
    const app = join(work, 'app');
    const packDir = join(work, 'pack');
    const tarball = readdirSync(packDir).find((f) => f.endsWith('.tgz'));
    expect(tarball).toBeDefined();
    const readme = readFileSync(join(PACKAGE_DIR, 'README.md'), 'utf8');
    const snippet = [...readme.matchAll(/```js\n([\s\S]*?)```/g)]
      .map((m) => m[1] as string)
      .find((s) => s.includes('createSandbox'));
    expect(snippet).toContain("import { createSandbox } from '@riftydev/isolate-host';");
    // The snippet's contract: it leaves `result` (the fixed run) and `pdf` (the bytes it read).
    writeFileSync(
      join(app, 'sandbox.js'),
      `${snippet}\nconsole.log(JSON.stringify({ result, pdf: Buffer.from(pdf).toString('latin1').slice(0, 8) }));\n`,
    );
    const out = execFileSync(process.execPath, ['sandbox.js'], {
      cwd: app,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
    });
    expect(JSON.parse(out)).toEqual({
      result: { stdout: expect.any(String), stderr: '', exitCode: 0 },
      pdf: '%PDF-1.4',
    });
  },
  240_000,
);
