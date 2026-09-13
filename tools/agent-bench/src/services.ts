import type { ChildProcess } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installedRegistry } from './installed-registry.ts';
import type { Lane } from './lanes/types.ts';
import {
  freePort,
  isHttpUp,
  killProcessGroup,
  runOrThrow,
  spawnLoggedServer,
  waitHttpReady,
} from './proc.ts';

/** A packed consumer outside the checkout; runtime assets come only from installed tarballs. */
async function packedPage(root: string) {
  const packages = new Map<string, { dir: string; dependencies: Record<string, string> }>();
  for (const area of ['packages', 'tools'])
    for (const entry of await readdir(area, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = resolve(area, entry.name);
      try {
        const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as {
          name: string;
          dependencies?: Record<string, string>;
        };
        packages.set(manifest.name, { dir, dependencies: manifest.dependencies ?? {} });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  const closure = new Map<string, string>();
  const pending = ['@riftydev/agent', '@riftydev/sdk'];
  while (pending.length) {
    const name = pending.pop()!;
    if (closure.has(name)) continue;
    const entry = packages.get(name);
    if (!entry) throw new Error(`Workspace dependency ${name} missing`);
    closure.set(name, entry.dir);
    pending.push(
      ...Object.entries(entry.dependencies)
        .filter(([, version]) => version.startsWith('workspace:'))
        .map(([name]) => name),
    );
  }
  const build = await runOrThrow('pnpm', ['build:libs'], { cwd: process.cwd(), timeoutMs: 600000 });
  await writeFile(join(root, 'build.log'), `${build.stdout}\n${build.stderr}`);
  const tarballs = join(root, 'tarballs');
  await mkdir(tarballs);
  const dependencies: Record<string, string> = {};
  for (const [name, dir] of closure) {
    const before = await readdir(tarballs);
    await runOrThrow('pnpm', ['pack', '--pack-destination', tarballs], {
      cwd: dir,
      timeoutMs: 120000,
    });
    const created = (await readdir(tarballs)).filter((path) => !before.includes(path));
    if (created.length !== 1) throw new Error(`Packing ${name} did not produce one tarball`);
    dependencies[name] = `file:${join(tarballs, created[0]!)}`;
  }
  const consumer = join(root, 'consumer');
  await mkdir(consumer);
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({
      name: 'rifty-agent-bench-packed-host',
      private: true,
      type: 'module',
      dependencies,
      overrides: Object.fromEntries(Object.keys(dependencies).map((name) => [name, `$${name}`])),
    }),
  );
  const registry = await installedRegistry(closure.values(), root);
  try {
    const installed = await runOrThrow(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        `--registry=${registry.origin}`,
        `--cache=${join(root, 'consumer-cache')}`,
      ],
      { cwd: consumer, timeoutMs: 300000 },
    );
    await writeFile(join(root, 'install.log'), `${installed.stdout}\n${installed.stderr}`);
    await writeFile(
      join(root, 'external-packages.json'),
      JSON.stringify(registry.entries, null, 2),
    );
  } finally {
    await registry.close();
  }
  await cp(resolve('tools/agent-bench/src/no-coi-page.ts'), join(consumer, 'main.ts'));
  // Type-only local FileTree import erases during bundling; imports of SDK/agent resolve in consumer/node_modules.
  await runOrThrow(
    'pnpm',
    [
      'exec',
      'esbuild',
      join(consumer, 'main.ts'),
      '--bundle',
      '--format=esm',
      '--platform=browser',
      '--target=chrome148',
      `--outfile=${join(consumer, 'public/main.js')}`,
    ],
    { cwd: process.cwd(), timeoutMs: 120000 },
  );
  await cp(
    join(consumer, 'node_modules/@riftydev/workbench/dist/assets'),
    join(consumer, 'public/rifty'),
    { recursive: true },
  );
  await writeFile(
    join(consumer, 'public/index.html'),
    '<!doctype html><html><body><iframe title="Task preview" style="width:100%;height:900px;border:0"></iframe><script type="module" src="/main.js"></script></body></html>',
  );
  return join(consumer, 'public');
}
export async function services(lanes: Lane[], port: number, output: string) {
  const playgroundUrl = `http://localhost:${port}/`;
  let playground: ChildProcess | null = null;
  let server: ReturnType<typeof createServer> | undefined;
  let noCoiUrl: string | undefined;
  const close = async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    await killProcessGroup(playground);
  };
  try {
    if (lanes.some((lane) => lane !== 'local-reference')) {
      if (!(await isHttpUp(playgroundUrl))) {
        playground = spawnLoggedServer('pnpm', ['exec', 'vite', '--force'], {
          cwd: resolve('apps/playground'),
          env: { ...process.env, RIFTY_PLAYGROUND_PORT: String(port) },
          logPath: join(output, 'playground.log'),
          detached: true,
        });
        await waitHttpReady(playgroundUrl, 120000, 'playground');
      }
    }
    if (lanes.includes('rifty-no-coi')) {
      const root = await mkdtemp(join(tmpdir(), 'rifty-agent-bench-packed-'));
      console.log(`PREPARE packed host ${root}`);
      await writeFile(
        join(output, 'packed-host.json'),
        JSON.stringify({ root, status: 'building' }),
      );
      const publicRoot = await packedPage(root);
      await writeFile(join(output, 'packed-host.json'), JSON.stringify({ root, publicRoot }));
      server = createServer(async (request, response) => {
        try {
          const path = new URL(request.url ?? '/', 'http://localhost').pathname;
          if (path.startsWith('/npm-registry/')) {
            const upstream = await fetch(new URL(request.url!, playgroundUrl));
            response.writeHead(upstream.status, {
              'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
            });
            response.end(Buffer.from(await upstream.arrayBuffer()));
            return;
          }
          const file = resolve(publicRoot, `.${path === '/' ? '/index.html' : path}`);
          if (!file.startsWith(`${publicRoot}/`)) throw new Error('Invalid asset path');
          const bytes = await readFile(file);
          response.writeHead(200, {
            'Content-Type': file.endsWith('.js')
              ? 'text/javascript'
              : file.endsWith('.wasm')
                ? 'application/wasm'
                : file.endsWith('.html')
                  ? 'text/html'
                  : 'application/octet-stream',
            'Service-Worker-Allowed': '/',
          });
          response.end(bytes);
        } catch (error) {
          response.writeHead(500);
          response.end(String(error));
        }
      });
      const noCoiPort = await freePort();
      await new Promise<void>((resolve) => server!.listen(noCoiPort, '127.0.0.1', resolve));
      noCoiUrl = `http://127.0.0.1:${noCoiPort}/`;
    }
    return { playgroundUrl, noCoiUrl, close };
  } catch (error) {
    await close();
    throw error;
  }
}
