import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';

const execFileAsync = promisify(execFile);
const outputPath = process.argv[2] ?? join(tmpdir(), 'rifty-peer-placement-probe-output.json');

const packages = {
  'contract-source': {
    '1.0.0': {
      name: 'contract-source',
      version: '1.0.0',
      peerDependencies: { 'contract-peer': '^2.0.0' },
    },
  },
  'contract-host': {
    '1.0.0': {
      name: 'contract-host',
      version: '1.0.0',
      dependencies: { 'contract-source': '1.0.0' },
    },
  },
  'contract-peer': {
    '1.0.0': { name: 'contract-peer', version: '1.0.0' },
    '2.0.0': {
      name: 'contract-peer',
      version: '2.0.0',
      dependencies: { 'contract-leaf': '1.0.0' },
    },
  },
  'contract-leaf': {
    '1.0.0': { name: 'contract-leaf', version: '1.0.0' },
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
  const pad = Buffer.alloc((512 - (bytes.length % 512)) % 512);
  return gzipSync(
    Buffer.concat([
      tarHeader('package/package.json', bytes.length),
      bytes,
      pad,
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
const registryRequests = [];
const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', origin).pathname;
  registryRequests.push(path);
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
    Object.entries(versions).map(([version, manifest]) => [
      version,
      {
        ...manifest,
        dist: {
          tarball: `${origin}/${name}/-/${name}-${version}.tgz`,
          integrity: `sha512-${createHash('sha512')
            .update(tarballs.get(`/${name}/-/${name}-${version}.tgz`))
            .digest('base64')}`,
        },
      },
    ]),
  );
  const body = JSON.stringify({
    name,
    'dist-tags': { latest: Object.keys(versions).at(-1) },
    versions: mapped,
  });
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(body);
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
origin = `http://127.0.0.1:${address.port}`;

function walk(root) {
  const out = {};
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(dir, entry.name);
      const rel = relative(root, path);
      if (rel.startsWith('.npm-cache')) continue;
      if (entry.isDirectory()) visit(path);
      else out[rel] = readFileSync(path).toString('utf8');
    }
  };
  if (existsSync(root)) visit(root);
  return out;
}

const cases = [
  {
    name: 'direct-missing',
    dependencies: { 'contract-source': '1.0.0' },
  },
  {
    name: 'nested-missing',
    dependencies: { 'contract-host': '1.0.0' },
  },
  {
    name: 'direct-conflict',
    dependencies: { 'contract-source': '1.0.0', 'contract-peer': '1.0.0' },
  },
  {
    name: 'nested-conflict',
    dependencies: { 'contract-host': '1.0.0', 'contract-peer': '1.0.0' },
  },
];

const evidence = {
  node: process.version,
  npm: spawnSync('npm', ['--version'], { encoding: 'utf8' }).stdout.trim(),
  cases: {},
};

async function runNpm(root, args) {
  let exit = 0;
  let signal = null;
  let stdout = '';
  let stderr = '';
  try {
    const run = await execFileAsync(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--no-update-notifier',
        '--loglevel=error',
        `--registry=${origin}`,
        ...args,
      ],
      {
        cwd: root,
        env: { ...process.env, npm_config_cache: join(root, '.npm-cache') },
        encoding: 'utf8',
        timeout: 20_000,
      },
    );
    stdout = run.stdout;
    stderr = run.stderr;
  } catch (error) {
    exit = typeof error.code === 'number' ? error.code : -1;
    signal = error.signal ?? null;
    stdout = error.stdout ?? '';
    stderr = error.stderr ?? '';
  }
  return {
    exit,
    signal,
    stdout: stdout
      .replaceAll(origin, '<registry>')
      .replace(/ in \d+(?:\.\d+)?(?:ms|s)\n/g, ' in <duration>\n'),
    stderr: stderr
      .replaceAll(origin, '<registry>')
      .replaceAll(root, '<root>')
      .replace(
        /<root>\/\.npm-cache\/_logs\/[^/\n]+-eresolve-report\.txt/g,
        '<root>/.npm-cache/_logs/<timestamp>-eresolve-report.txt',
      )
      .replace(/npm error A complete log of this run can be found in:.*\n?/g, ''),
  };
}

function capturedFiles(root) {
  return Object.fromEntries(
    Object.entries(walk(root))
      .filter(([path]) => path === 'package-lock.json' || path.startsWith('node_modules/'))
      .map(([path, text]) => [path, text.replaceAll(origin, '<registry>')]),
  );
}

for (const item of cases) {
  const root = mkdtempSync(join(tmpdir(), `peer-${item.name}-`));
  try {
    writeFileSync(
      join(root, 'package.json'),
      `${JSON.stringify({
        name: `peer-${item.name}`,
        version: '1.0.0',
        private: true,
        dependencies: item.dependencies,
      })}\n`,
    );
    registryRequests.length = 0;
    const freshResult = await runNpm(root, []);
    const freshFiles = capturedFiles(root);
    evidence.cases[item.name] = {
      fresh: {
        ...freshResult,
        registryRequests: [...registryRequests].sort(),
        files: freshFiles,
      },
    };
    if (freshResult.exit === 0) {
      rmSync(join(root, 'node_modules'), { recursive: true, force: true });
      registryRequests.length = 0;
      const replayResult = await runNpm(root, ['--offline']);
      evidence.cases[item.name].offlineReplay = {
        ...replayResult,
        registryRequests: [...registryRequests].sort(),
        files: capturedFiles(root),
      };
    } else {
      evidence.cases[item.name].absentAfterFailure = {
        nodeModules: !existsSync(join(root, 'node_modules')),
        packageLock: !existsSync(join(root, 'package-lock.json')),
      };
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
await new Promise((resolve) => server.close(resolve));
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(outputPath);
