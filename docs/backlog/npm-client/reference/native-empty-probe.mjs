import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const fixture = fileURLToPath(
  new URL('../../../../tests/integration/fixtures/registry/ms-2.1.3.tgz', import.meta.url),
);
const bytes = await readFile(fixture);
const olderPath = fixture.replace('2.1.3', '2.0.0');
const olderBytes = await readFile(olderPath);
const olderManifest = JSON.parse(
  execFileSync('tar', ['-xOf', olderPath, 'package/package.json'], { encoding: 'utf8' }),
);
const manifest = JSON.parse(
  execFileSync('tar', ['-xOf', fixture, 'package/package.json'], { encoding: 'utf8' }),
);
const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
let origin;
const server = createServer((req, res) => {
  if (req.url === '/ms/-/ms-2.1.3.tgz') {
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.end(bytes);
    return;
  }
  if (req.url === '/ms/-/ms-2.0.0.tgz') {
    res.writeHead(200);
    res.end(olderBytes);
    return;
  }
  if (req.url === '/ms') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        name: 'ms',
        'dist-tags': { latest: '2.1.3' },
        versions: {
          '2.0.0': {
            ...olderManifest,
            dist: {
              tarball: `${origin}/ms/-/ms-2.0.0.tgz`,
              integrity: `sha512-${createHash('sha512').update(olderBytes).digest('base64')}`,
            },
          },
          '2.1.3': { ...manifest, dist: { tarball: `${origin}/ms/-/ms-2.1.3.tgz`, integrity } },
        },
      }),
    );
    return;
  }
  res.writeHead(404);
  res.end('missing fixture');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${server.address().port}`;
const dir = await mkdtemp('/tmp/rifty-pr357-npm-oracle-');
const cases = [];
try {
  for (const args of [['ms'], []]) {
    const cwd = await mkdtemp(join(dir, 'case-'));

    const executed = await exec(
      'npm',
      [
        'install',
        ...args,
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--prefer-online',
        '--registry',
        origin,
        '--cache',
        join(dir, 'cache'),
      ],
      { cwd },
    ).then(
      () => ({ ok: true }),
      (error) => ({ ok: false, code: error.code, stderr: error.stderr }),
    );
    const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8').catch(() => 'null'));
    const lock = JSON.parse(
      await readFile(join(cwd, 'package-lock.json'), 'utf8').catch(() => 'null'),
    );
    cases.push({ args, executed, pkg, lock });
  }
  console.log(
    JSON.stringify(
      {
        node: process.version,
        npm: (await exec('npm', ['--version'])).stdout.trim(),
        integrity,
        cases,
      },
      null,
      2,
    ),
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
