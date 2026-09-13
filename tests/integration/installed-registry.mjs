// Real installed dependency closure, npm-packed tarballs and a loopback registry serving
// them. Shared by the packed-consumer gate and tools/agent-bench's packed no-COI host.
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, dirname, resolve } from 'node:path';
import { installedPackagePackPlan } from './workbench-packed-consumer-package-manager.mjs';

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function findInstalledPackage(name, startingDirectory) {
  let directory = startingDirectory;
  while (true) {
    const candidate = resolve(directory, 'node_modules', ...name.split('/'));
    try {
      return await realpath(candidate);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`Cannot resolve installed package ${name} from ${startingDirectory}`);
    }
    directory = parent;
  }
}

function installedDependencyNames(manifest) {
  return [
    ...new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]),
  ];
}

function isOptionalInstalledDependency(manifest, name) {
  return (
    Object.hasOwn(manifest.optionalDependencies ?? {}, name) ||
    manifest.peerDependenciesMeta?.[name]?.optional === true
  );
}

/** Walk installed dependency trees from seed package directories; identity = name@version. */
export async function installedClosure(seedDirectories) {
  const pending = [...seedDirectories];
  const closure = new Map();
  while (pending.length > 0) {
    const dir = pending.pop();
    if (dir === undefined) continue;
    const manifest = await readJson(resolve(dir, 'package.json'));
    const identity = `${manifest.name}@${manifest.version}`;
    if (closure.has(identity)) continue;
    closure.set(identity, { dir, manifest });
    for (const name of installedDependencyNames(manifest)) {
      try {
        pending.push(await findInstalledPackage(name, dir));
      } catch (error) {
        if (!isOptionalInstalledDependency(manifest, name)) throw error;
      }
    }
  }
  return closure;
}

/** `run` executes the pack plan command; the caller owns process env merging and timeouts. */
export async function packInstalledPackages(packages, tarballRoot, npmCacheRoot, run) {
  const tarballs = new Map();
  const stagingRoot = resolve(
    dirname(tarballRoot),
    `${basename(tarballRoot)}-installed-package-staging`,
  );
  await mkdir(stagingRoot, { recursive: true });
  let packageIndex = 0;
  for (const [name, packageEntry] of packages) {
    const before = new Set(await readdir(tarballRoot));
    const packPlan = installedPackagePackPlan(
      packageEntry.dir,
      resolve(stagingRoot, String(packageIndex)),
      tarballRoot,
      npmCacheRoot,
    );
    packageIndex += 1;
    await cp(packPlan.copy.source, packPlan.copy.destination, packPlan.copy.options);
    await run(packPlan.command.command, packPlan.command.args, packPlan.command.options);
    const created = (await readdir(tarballRoot)).filter(
      (entry) => entry.endsWith('.tgz') && !before.has(entry),
    );
    if (created.length !== 1) {
      throw new Error(`Packing ${name} created ${created.length} tarballs: ${created.join(', ')}`);
    }
    tarballs.set(name, resolve(tarballRoot, created[0]));
  }
  return tarballs;
}

export function tarballIntegrity(bytes) {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

/** Registry entries for a packed closure: manifest plus the exact tarball bytes' identity. */
export async function registryEntries(closure, tarballs) {
  const entries = new Map();
  for (const [identity, entry] of closure) {
    const tarball = tarballs.get(identity);
    if (!tarball) throw new Error(`Missing installed tarball ${identity}`);
    const bytes = await readFile(tarball);
    entries.set(identity, {
      name: entry.manifest.name,
      manifest: entry.manifest,
      tarball,
      integrity: tarballIntegrity(bytes),
      shasum: createHash('sha1').update(bytes).digest('hex'),
    });
  }
  return entries;
}

export function listen(server, port = 0) {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error) => {
      server.off('listening', onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

export function closeServer(server) {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error === undefined ? resolveClose() : rejectClose(error)));
  });
}

export function sendResponse(request, response, status, headers, body) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    ...headers,
  });
  if (request.method === 'HEAD' || body === undefined) response.end();
  else response.end(body);
}

/**
 * Serve packuments and tarballs for `packages` (identity → registry entry) on loopback.
 * `registerClose` lets a caller own cleanup ordering; default closes on `close()`.
 */
export async function startInstalledRegistry(packages, options = {}) {
  const requests = [];
  const responses = [];
  let origin = '';
  let denied = false;
  const tarballRoutes = new Map();
  const server = createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url ?? '/', origin || 'http://127.0.0.1');
      requests.push(`${request.method ?? 'GET'} ${requestUrl.pathname}`);
      if (denied) {
        sendResponse(
          request,
          response,
          503,
          { 'Content-Type': 'text/plain' },
          'Registry denied by snapshot-only proof',
        );
        return;
      }
      if (request.method === 'OPTIONS') {
        sendResponse(request, response, 204, { 'Access-Control-Allow-Methods': 'GET, HEAD' });
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendResponse(request, response, 405, { Allow: 'GET, HEAD' });
        return;
      }

      const tarballPackage = tarballRoutes.get(requestUrl.pathname);
      if (tarballPackage !== undefined) {
        const bytes = await readFile(tarballPackage.tarball);
        responses.push({ kind: 'tarball', packageName: tarballPackage.name, status: 200 });
        sendResponse(
          request,
          response,
          200,
          {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(bytes.byteLength),
          },
          bytes,
        );
        return;
      }

      let name;
      try {
        name = decodeURIComponent(requestUrl.pathname.slice(1));
      } catch {
        sendResponse(request, response, 400, { 'Content-Type': 'application/json' }, '{}');
        return;
      }
      const entries = [...packages.values()].filter((entry) => entry.manifest.name === name);
      if (entries.length === 0) {
        sendResponse(request, response, 404, { 'Content-Type': 'application/json' }, '{}');
        return;
      }
      const versions = {};
      for (const entry of entries) {
        const tarballPath = [...tarballRoutes].find(([, candidate]) => candidate === entry)?.[0];
        if (tarballPath === undefined)
          throw new Error(`Missing registry tarball route for ${name}`);
        versions[entry.manifest.version] = {
          ...entry.manifest,
          dist: {
            tarball: `${origin}${tarballPath}`,
            integrity: entry.integrity,
            shasum: entry.shasum,
          },
        };
      }
      const body = Buffer.from(
        JSON.stringify({
          _id: name,
          name,
          'dist-tags': entries.length === 1 ? { latest: entries[0].manifest.version } : {},
          versions,
        }),
      );
      responses.push({ kind: 'packument', packageName: name, status: 200 });
      sendResponse(
        request,
        response,
        200,
        { 'Content-Type': 'application/json', 'Content-Length': String(body.byteLength) },
        body,
      );
    })().catch((error) => {
      if (!response.headersSent) {
        sendResponse(
          request,
          response,
          500,
          { 'Content-Type': 'text/plain' },
          Buffer.from(error instanceof Error ? error.message : String(error)),
        );
      } else {
        response.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
  const listening = listen(server);
  const close = async () => {
    await listening.catch(() => {});
    if (!server.listening) return;
    server.closeAllConnections();
    await closeServer(server);
  };
  const registered = options.registerClose?.(close) ?? { cleanup: close };
  await listening;
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Installed registry did not bind a TCP port');
  }
  origin = `http://127.0.0.1:${address.port}`;
  for (const packageEntry of packages.values()) {
    const tarballPath = `/-/tarballs/${encodeURIComponent(packageEntry.manifest.name)}-${packageEntry.manifest.version}.tgz`;
    tarballRoutes.set(tarballPath, packageEntry);
  }
  server.unref();
  return {
    origin,
    requests,
    responses,
    assertResolution(entry) {
      const url = new URL(entry.resolved);
      const artifact = url.origin === origin ? tarballRoutes.get(url.pathname) : undefined;
      if (
        !artifact ||
        entry.integrity !== artifact.integrity ||
        entry.version !== artifact.manifest.version
      ) {
        throw new Error(`Consumer resolution is not an exact local tarball: ${entry.resolved}`);
      }
    },
    deny: () => {
      denied = true;
    },
    close: () => registered.cleanup(),
  };
}
