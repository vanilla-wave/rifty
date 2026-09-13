import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { runOrThrow } from './proc.ts';
interface Manifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}
async function installed(name: string, start: string): Promise<string> {
  let dir = start;
  while (true) {
    try {
      return await realpath(join(dir, 'node_modules', name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`Installed package ${name} missing from ${start}`);
    dir = parent;
  }
}
/** Real installed dependency tarballs, as the existing packed-consumer gate uses. */
export async function installedRegistry(owners: Iterable<string>, root: string) {
  const pending: string[] = [];
  for (const dir of owners) {
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as Manifest;
    for (const [name, version] of Object.entries(manifest.dependencies ?? {}))
      if (!version.startsWith('workspace:')) pending.push(await installed(name, dir));
  }
  const closure = new Map<string, { dir: string; manifest: Manifest }>();
  while (pending.length) {
    const dir = pending.pop()!;
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as Manifest;
    const identity = `${manifest.name}@${manifest.version}`;
    if (closure.has(identity)) continue;
    closure.set(identity, { dir, manifest });
    for (const name of new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ])) {
      try {
        pending.push(await installed(name, dir));
      } catch (error) {
        if (
          !Object.hasOwn(manifest.optionalDependencies ?? {}, name) &&
          !manifest.peerDependenciesMeta?.[name]?.optional
        )
          throw error;
      }
    }
  }
  console.log(`PACK ${closure.size} real installed dependency versions`);
  const tarballs = join(root, 'external-tarballs');
  await mkdir(tarballs);
  const entries: { manifest: Manifest; tarball: string; integrity: string }[] = [];
  for (const { dir, manifest } of closure.values()) {
    const stage = join(root, 'external-staging', String(entries.length));
    await cp(dir, stage, { recursive: true, dereference: true });
    const before = await readdir(tarballs);
    await runOrThrow(
      'npm',
      ['pack', '--ignore-scripts', '--offline', '--pack-destination', tarballs],
      {
        cwd: stage,
        env: { ...process.env, npm_config_cache: join(root, 'pack-cache') },
        timeoutMs: 120000,
      },
    );
    const created = (await readdir(tarballs)).filter((name) => !before.includes(name));
    if (created.length !== 1)
      throw new Error(`Packing installed ${manifest.name} did not produce one tarball`);
    const tarball = join(tarballs, created[0]!);
    const integrity = `sha512-${createHash('sha512')
      .update(await readFile(tarball))
      .digest('base64')}`;
    entries.push({ manifest, tarball, integrity });
  }
  let origin = '';
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url ?? '/', origin).pathname).slice(1);
      if (path.startsWith('-/')) {
        const entry = entries[Number(path.slice(2))];
        if (!entry) {
          response.writeHead(404);
          response.end();
          return;
        }
        response.end(await readFile(entry.tarball));
        return;
      }
      const versions = Object.fromEntries(
        entries
          .map((entry, index) => ({ entry, index }))
          .filter(({ entry }) => entry.manifest.name === path)
          .map(({ entry, index }) => [
            entry.manifest.version,
            {
              ...entry.manifest,
              dist: { tarball: `${origin}/-/${index}`, integrity: entry.integrity },
            },
          ]),
      );
      if (!Object.keys(versions).length) {
        response.writeHead(404);
        response.end(JSON.stringify({ error: `Not in installed closure: ${path}` }));
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          name: path,
          'dist-tags': { latest: Object.keys(versions).at(-1) },
          versions,
        }),
      );
    } catch (error) {
      response.writeHead(500);
      response.end(String(error));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Installed registry did not bind');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    entries,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
