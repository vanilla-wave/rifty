import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
const execute = promisify(execFile);
const fixtureRoot = dirname(fileURLToPath(import.meta.url));
const registryRoot = resolve(fixtureRoot, '../../integration/fixtures/registry');
const corpusRoot = join(registryRoot, 'replica-scale');
export const scaleNamespace = 'replica-public-scale';
export const installLine =
  'npm install @gravity-ui/icons@2.18.0 lodash@4.18.1 lodash-es@4.18.1 dom-helpers@5.2.1 react@18.3.1';
import { program } from './replica-public-scale-program.ts';
interface PackageFixture {
  readonly name: string;
  readonly version: string;
  readonly filename: string;
  readonly integrity: string;
  readonly packageJson: Record<string, unknown>;
}

/** Actual upstream archives; procedural T manifest bytes are explicitly inert scale data. */
export async function createPublicScaleFixture(directory: string) {
  await execute(
    'pnpm',
    ['exec', 'tsx', join(fixtureRoot, 'replica-public-scale-snapshot.mts'), directory],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  const msMetadata = JSON.parse(
    await readFile(join(directory, 'ms-metadata.json'), 'utf8'),
  ) as Record<string, unknown> & { dist: { integrity: string } };
  // Same published worker build as consumers; no Vite server or route fulfillment on reopen.
  await execute(process.execPath, ['tools/publishing/build-workbench-assets.mjs'], {
    cwd: process.cwd(),
    maxBuffer: 8 * 1024 * 1024,
  });
  const assets = join(directory, 'assets');
  await cp(resolve('packages/workbench/dist/assets'), assets, { recursive: true });
  const chunk = (
    await Promise.all(
      (
        await readdir(assets)
      )
        .filter((name) => name.startsWith('chunk-') && name.endsWith('.js'))
        .map(async (name) => ({ name, source: await readFile(join(assets, name), 'utf8') })),
    )
  ).find(({ source }) => /export\s*\{[^}]*\bOpfsFsSync\b/s.test(source));
  if (!chunk) throw new Error('Published owner VFS binding missing');
  // Observe the SAME class imported by the shipped owner; every method calls its original.
  await writeFile(
    join(assets, 'owner-measured.js'),
    `
import {OpfsFsSync, init_src} from './${chunk.name}';
init_src();
const nativeFlush=OpfsFsSync.prototype.flush, nativeWrite=OpfsFsSync.prototype.writeFileSync;
let flushes=[], writes=new Set();
OpfsFsSync.prototype.flush=async function(...args){const start=performance.now();try{return await nativeFlush.apply(this,args);}finally{flushes.push(performance.now()-start);}};
OpfsFsSync.prototype.writeFileSync=function(path,...args){const result=nativeWrite.call(this,path,...args);if(path.includes('/projects/scratch/tree/node_modules/')&&!path.includes('/.tracker-scale'))writes.add(path);return result;};
const channel=new BroadcastChannel('replica-public-scale-measure');
channel.onmessage=({data})=>{if(data.op==='reset'){flushes=[];writes=new Set();}channel.postMessage({id:data.id,flushes,writes:writes.size});if(data.op==='close')channel.close();};
await import('./owner-worker.js');
`,
  );
  await build({
    entryPoints: [join(fixtureRoot, 'replica-public-scale-client.ts')],
    outfile: join(directory, 'client.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    logLevel: 'silent',
  });
  const packages = JSON.parse(
    await readFile(join(corpusRoot, 'registry-fixture.json'), 'utf8'),
  ) as PackageFixture[];
  packages.push({
    name: 'ms',
    version: '2.0.0',
    filename: 'ms-2.0.0.tgz',
    integrity: msMetadata.dist.integrity,
    packageJson: msMetadata,
  });
  const archives = new Map<string, Uint8Array>();
  const reference = join(directory, 'node-reference');
  for (const pack of packages) {
    const path = join(pack.name === 'ms' ? registryRoot : corpusRoot, pack.filename);
    const bytes = await readFile(path);
    if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== pack.integrity)
      throw new Error(`Original archive integrity mismatch: ${pack.name}`);
    archives.set(pack.filename, bytes);
    const destination = join(reference, 'node_modules', pack.name);
    await mkdir(destination, { recursive: true });
    await execute('tar', ['-xzf', path, '--strip-components=1', '-C', destination]);
  }
  await writeFile(join(reference, 'main.cjs'), program);
  const nodeVersion = (await execute(process.execPath, ['--version'])).stdout.trim();
  const oracle: Record<string, string> = {};
  for (const note of ['initial', 'edited'])
    for (const installed of [false, true]) {
      await writeFile(join(reference, 'note.txt'), note);
      oracle[`${note}:${installed}`] = (
        await execute(process.execPath, ['main.cjs', ...(installed ? ['--installed'] : [])], {
          cwd: reference,
        })
      ).stdout;
    }
  const requests: string[] = [];
  let offline = false;
  const server = http.createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url ?? '/', 'http://fixture.invalid').pathname);
      requests.push(path);
      if (offline) {
        req.socket.destroy();
        return;
      }
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
      res.setHeader('Service-Worker-Allowed', '/');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      if (path.startsWith('/registry/')) {
        const key = path.slice('/registry/'.length);
        const pack = packages.find((p) => p.name === key || `${p.name}/${p.version}` === key);
        if (pack) {
          const address = server.address();
          if (!address || typeof address === 'string') throw new Error('Server not listening');
          const metadata = {
            ...pack.packageJson,
            dist: {
              tarball: `http://127.0.0.1:${address.port}/registry/-/${pack.filename}`,
              integrity: pack.integrity,
            },
          };
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify(
              key === pack.name
                ? {
                    name: pack.name,
                    'dist-tags': { latest: pack.version },
                    versions: { [pack.version]: metadata },
                  }
                : metadata,
            ),
          );
          return;
        }
        const archive = [...archives].find(([filename]) => path.endsWith(`/${filename}`));
        if (!archive) throw new Error(`Unexpected registry request ${path}`);
        res.end(archive[1]);
        return;
      }
      if (path === '/') {
        res.setHeader('Content-Type', 'text/html');
        res.end(
          '<!doctype html><script type="module" src="/client.js"></script><body>Public replica proof</body>',
        );
        return;
      }
      const file = resolve(directory, `.${path}`);
      if (!file.startsWith(`${directory}/`)) throw new Error('Outside fixture');
      res.setHeader(
        'Content-Type',
        path.endsWith('.js')
          ? 'text/javascript'
          : path.endsWith('.wasm')
            ? 'application/wasm'
            : path.endsWith('.json')
              ? 'application/json'
              : 'application/octet-stream',
      );
      res.end(await readFile(file));
    } catch (error) {
      res.statusCode = 404;
      res.end(String(error));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server not listening');
  return {
    url: `http://127.0.0.1:${address.port}/`,
    oracle,
    nodeVersion,
    requests,
    setOffline(value: boolean) {
      offline = value;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
