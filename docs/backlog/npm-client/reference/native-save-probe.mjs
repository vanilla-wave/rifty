import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const exec = promisify(execFile);
const fixture = fileURLToPath(new URL('../../../../tests/integration/fixtures/registry/ms-2.1.3.tgz', import.meta.url));
const bytes = await readFile(fixture);
const olderPath = fixture.replace('2.1.3', '2.0.0');
const olderBytes = await readFile(olderPath);
const olderManifest = JSON.parse(execFileSync('tar', ['-xOf', olderPath, 'package/package.json'], { encoding: 'utf8' }));
const manifest = JSON.parse(execFileSync('tar', ['-xOf', fixture, 'package/package.json'], { encoding: 'utf8' }));
const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
let origin;
const server = createServer((req, res) => {
  if (req.url === '/ms/-/ms-2.1.3.tgz') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(bytes); return; }
  if (req.url === '/ms/-/ms-2.0.0.tgz') { res.writeHead(200); res.end(olderBytes); return; }
  if (req.url === '/ms') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ name: 'ms', 'dist-tags': { latest: '2.1.3' }, versions: { '2.0.0': { ...olderManifest, dist: { tarball: `${origin}/ms/-/ms-2.0.0.tgz`, integrity: `sha512-${createHash('sha512').update(olderBytes).digest('base64')}` } }, '2.1.3': { ...manifest, dist: { tarball: `${origin}/ms/-/ms-2.1.3.tgz`, integrity } } } })); return; }
  res.writeHead(404); res.end('missing fixture');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${server.address().port}`;
const dir = await mkdtemp('/tmp/rifty-pr357-npm-oracle-');
const cases = [];
try {
  for (const args of [['ms'], ['ms@2.1.3'], ['ms@^2.0.0'], ['ms', '--save-exact'], ['ms', '--save-dev'], ['ms@~2.0.0'], ['ms@>=2.0.0 <3'], ['ms@2'], ['ms@latest']]) {
    const cwd = await mkdtemp(join(dir, 'case-'));
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'install-oracle', version: '1.0.0', private: true }));
    await exec('npm', ['install', ...args, '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-online', '--registry', origin, '--cache', join(dir, 'cache')], { cwd });
    const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
    const lock = JSON.parse(await readFile(join(cwd, 'package-lock.json'), 'utf8'));
    cases.push({ args, dependencies: pkg.dependencies, devDependencies: pkg.devDependencies, lockRoot: lock.packages[''], installedVersion: lock.packages['node_modules/ms'].version });
  }
  console.log(JSON.stringify({ node: process.version, npm: (await exec('npm', ['--version'])).stdout.trim(), integrity, cases }, null, 2));
} finally { await new Promise(resolve => server.close(resolve)); }
