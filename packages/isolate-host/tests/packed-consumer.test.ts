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
    `${snippet}\nconsole.log(JSON.stringify({ stdout, stderr, exitCode }));\n`,
  );
  const out = execFileSync(process.execPath, ['main.js'], {
    cwd: app,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
  });
  expect(JSON.parse(out)).toEqual({ stdout: '42\n', stderr: '', exitCode: 0 });
}, 240_000);
