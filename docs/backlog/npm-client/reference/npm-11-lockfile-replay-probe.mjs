import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';

const execFileAsync = promisify(execFile);
const outputPath = process.argv[2] ?? join(tmpdir(), 'rifty-lockfile-replay-probe-output.json');
const packages = {
  'optional-host': {
    '1.0.0': {
      name: 'optional-host',
      version: '1.0.0',
      optionalDependencies: { 'wasm-binding': '1.0.0', 'native-binding': '1.0.0' },
    },
  },
  'wasm-binding': {
    '1.0.0': { name: 'wasm-binding', version: '1.0.0', cpu: ['wasm32'] },
  },
  'native-binding': {
    '1.0.0': { name: 'native-binding', version: '1.0.0', cpu: ['x64'] },
  },
  'peer-source': {
    '1.0.0': {
      name: 'peer-source',
      version: '1.0.0',
      peerDependencies: { 'peer-target': '1.0.0' },
    },
  },
  'peer-target': { '1.0.0': { name: 'peer-target', version: '1.0.0' } },
  // Peer RANGE case: npm records the range verbatim on the source entry and
  // replays it onto the exact pinned entry (1.2.0) without re-resolving.
  'range-peer-source': {
    '1.0.0': {
      name: 'range-peer-source',
      version: '1.0.0',
      peerDependencies: { 'range-peer-target': '^1.0.0' },
    },
  },
  'range-peer-target': {
    '1.2.0': { name: 'range-peer-target', version: '1.2.0' },
  },
};

function tarHeader(path, size) {
  const header = Buffer.alloc(512);
  header.write(path, 0);
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  header.write('00000000000\0', 136);
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  header.write('ustar\0', 257);
  header.write('00', 263);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return header;
}

function tarball(manifest) {
  const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  const padding = Buffer.alloc((512 - (bytes.length % 512)) % 512);
  return gzipSync(
    Buffer.concat([
      tarHeader('package/package.json', bytes.length),
      bytes,
      padding,
      Buffer.alloc(1024),
    ]),
    { level: 9, mtime: 0 },
  );
}

const tarballs = new Map();
for (const [name, versions] of Object.entries(packages)) {
  for (const [version, manifest] of Object.entries(versions)) {
    tarballs.set(`/${name}/-/${name}-${version}.tgz`, tarball(manifest));
  }
}

let origin = '';
const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', origin).pathname;
  const archive = tarballs.get(path);
  if (archive) {
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.end(archive);
    return;
  }
  const name = decodeURIComponent(path.slice(1));
  const versions = packages[name];
  if (!versions) {
    response.writeHead(404);
    response.end();
    return;
  }
  const mapped = Object.fromEntries(
    Object.entries(versions).map(([version, manifest]) => {
      const archivePath = `/${name}/-/${name}-${version}.tgz`;
      return [
        version,
        {
          ...manifest,
          dist: {
            tarball: `${origin}${archivePath}`,
            integrity: `sha512-${createHash('sha512').update(tarballs.get(archivePath)).digest('base64')}`,
          },
        },
      ];
    }),
  );
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ name, 'dist-tags': { latest: '1.0.0' }, versions: mapped }));
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
origin = `http://127.0.0.1:${address.port}`;
const root = mkdtempSync(join(tmpdir(), 'rifty-lockfile-replay-'));
try {
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({
      name: 'lockfile-replay-probe',
      version: '1.0.0',
      private: true,
      dependencies: {
        'optional-host': '1.0.0',
        'peer-source': '1.0.0',
        // range-peer-target is NOT a root dependency: it is reachable ONLY
        // through range-peer-source's ^1.0.0 peer edge, so the recorded lock
        // proves npm pins and replays a peer-RANGE-only entry.
        'range-peer-source': '1.0.0',
      },
    })}\n`,
  );
  let exit = 0;
  let stdout = '';
  let stderr = '';
  try {
    const result = await execFileAsync(
      'npm',
      [
        'install',
        '--package-lock-only',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--no-update-notifier',
        '--loglevel=error',
        `--registry=${origin}`,
      ],
      { cwd: root, encoding: 'utf8', timeout: 20_000 },
    );
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    exit = typeof error.code === 'number' ? error.code : -1;
    stdout = error.stdout ?? '';
    stderr = error.stderr ?? '';
  }
  const lockfile = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const optionalHost = lockfile.packages['node_modules/optional-host'];
  const peerSource = lockfile.packages['node_modules/peer-source'];
  // Replay proof: full reify from the written lock (`npm ci`). npm must
  // materialize the ranged peer edge onto the exact pinned entry.
  let ciExit = 0;
  let ciStderr = '';
  try {
    const ci = await execFileAsync(
      'npm',
      [
        'ci',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--no-update-notifier',
        '--loglevel=error',
        `--registry=${origin}`,
      ],
      { cwd: root, encoding: 'utf8', timeout: 20_000 },
    );
    ciStderr = ci.stderr;
  } catch (error) {
    ciExit = typeof error.code === 'number' ? error.code : -1;
    ciStderr = error.stderr ?? '';
  }
  const reifiedRangePeerTarget = JSON.parse(
    readFileSync(join(root, 'node_modules/range-peer-target/package.json'), 'utf8'),
  );
  const summary = {
    node: process.version,
    npm: (await execFileAsync('npm', ['--version'], { encoding: 'utf8' })).stdout.trim(),
    exit,
    stdout,
    stderr,
    lockfileVersion: lockfile.lockfileVersion,
    optionalDependencies: optionalHost.optionalDependencies,
    optionalCpu: {
      wasm: lockfile.packages['node_modules/wasm-binding'].cpu,
      native: lockfile.packages['node_modules/native-binding'].cpu,
    },
    peerDependencies: peerSource.peerDependencies,
    rangePeer: {
      recordedRange:
        lockfile.packages['node_modules/range-peer-source'].peerDependencies,
      pinnedVersion: lockfile.packages['node_modules/range-peer-target'].version,
      ciExit,
      ciStderr,
      reifiedVersion: reifiedRangePeerTarget.version,
    },
    packagePaths: Object.keys(lockfile.packages).sort(),
  };
  writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
} finally {
  server.close();
  rmSync(root, { recursive: true, force: true });
}
