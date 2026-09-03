#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import ts from 'typescript';
import { assertExactFirstPartyImports } from './workbench-packed-consumer-package-contract.mjs';
import { installedPackagePackPlan } from './workbench-packed-consumer-package-manager.mjs';
import { createResourceCleanup } from './workbench-packed-consumer-resource-cleanup.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const surfaceOnly = process.argv.includes('--surface-only');
const fixtureRoot = resolve(
  repoRoot,
  surfaceOnly
    ? 'tests/integration/fixtures/no-coi-packed-toolchain-consumer'
    : 'tests/integration/fixtures/workbench-vite-consumer',
);
const workbenchRoot = resolve(repoRoot, 'packages/workbench');
const viteSnapshot = resolve(
  repoRoot,
  'apps/playground/public/snapshots/vite-node-modules.json.gz',
);
const esbuildWasmManifest = resolve(
  repoRoot,
  'tools/shadow-registry/node_modules/esbuild-wasm/package.json',
);
const keepTemp = process.argv.includes('--keep');
const unknownArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== '--keep' && argument !== '--surface-only');
if (unknownArguments.length > 0) {
  throw new Error(`Unknown packed-consumer arguments: ${unknownArguments.join(', ')}`);
}

const maxCapturedOutput = 1024 * 1024;
const gunzipAsync = promisify(gunzip);
const resources = createResourceCleanup({
  exit: (code) => process.exit(code),
  reportError: (error) => {
    console.error(error instanceof Error ? error.stack : error);
  },
});

function appendBounded(current, chunk) {
  const next = current + String(chunk);
  return next.length <= maxCapturedOutput ? next : next.slice(-maxCapturedOutput);
}

function run(command, args, options = {}) {
  const cwd = options.cwd ?? repoRoot;
  const timeoutMs = options.timeoutMs ?? 180_000;
  console.log(`$ ${command} ${args.join(' ')}  # cwd=${relative(repoRoot, cwd) || '.'}`);
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        CI: '1',
        COREPACK_ENABLE_NETWORK: '0',
        ...(options.env ?? {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let completed = false;
    let forceKill;
    let resolveClosed;
    const closed = new Promise((resolveClose) => {
      resolveClosed = resolveClose;
    });
    const childResource = resources.register(async () => {
      if (completed) return;
      child.kill('SIGTERM');
      await Promise.race([closed, delay(5_000)]);
      if (!completed) child.kill('SIGKILL');
      await withDeadline(closed, 5_000, `${command} did not close after SIGKILL`);
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKill = setTimeout(() => {
        if (!completed) child.kill('SIGKILL');
      }, 5_000);
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.on('error', (error) => {
      completed = true;
      clearTimeout(timeout);
      clearTimeout(forceKill);
      childResource.disarm();
      resolveClosed();
      rejectRun(error);
    });
    child.on('close', (code) => {
      completed = true;
      clearTimeout(timeout);
      clearTimeout(forceKill);
      childResource.disarm();
      resolveClosed();
      if (code === 0 && !timedOut) {
        resolveRun({ stdout, stderr });
        return;
      }
      rejectRun(
        new Error(
          [
            timedOut
              ? `${command} exceeded ${timeoutMs}ms`
              : `${command} exited with code ${String(code)}`,
            stdout,
            stderr,
          ]
            .filter(Boolean)
            .join('\n'),
        ),
      );
    });
  });
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function findInstalledPackage(name, startingDirectory) {
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

async function workspacePackages() {
  const roots = [resolve(repoRoot, 'packages'), resolve(repoRoot, 'tools')];
  const packages = new Map();
  for (const root of roots) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = resolve(root, entry.name);
      try {
        const manifest = await readJson(resolve(dir, 'package.json'));
        if (typeof manifest.name === 'string') packages.set(manifest.name, { dir, manifest });
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }
  return packages;
}

function workspaceDependencyNames(manifest) {
  return Object.entries(manifest.dependencies ?? {})
    .filter(([, specifier]) => typeof specifier === 'string' && specifier.startsWith('workspace:'))
    .map(([name]) => name);
}

async function packedDependencyClosure() {
  const packages = await workspacePackages();
  const pending = ['@riftydev/sdk', '@riftydev/workbench'];
  const closure = new Map();
  while (pending.length > 0) {
    const name = pending.pop();
    if (name === undefined || closure.has(name)) continue;
    const workspacePackage = packages.get(name);
    if (workspacePackage === undefined) {
      throw new Error(`Missing workspace package for packed dependency ${name}`);
    }
    closure.set(name, workspacePackage);
    pending.push(...workspaceDependencyNames(workspacePackage.manifest));
  }
  return [...closure.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function externalDependencyNames(manifest) {
  return Object.entries(manifest.dependencies ?? {})
    .filter(([, specifier]) => typeof specifier !== 'string' || !specifier.startsWith('workspace:'))
    .map(([name]) => name);
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

async function resolveFixtureExternal(name, version, contexts) {
  const mismatches = [];
  for (const context of contexts) {
    try {
      const dir = await findInstalledPackage(name, context);
      const manifest = await readJson(resolve(dir, 'package.json'));
      if (manifest.version === version) return dir;
      mismatches.push(`${manifest.version} from ${relative(repoRoot, context) || '.'}`);
    } catch (error) {
      if (!String(error).includes('Cannot resolve installed package')) throw error;
    }
  }
  throw new Error(
    `Cannot resolve fixture package ${name}@${version}${
      mismatches.length === 0 ? '' : `; found ${mismatches.join(', ')}`
    }`,
  );
}

async function externalDependencyClosure(workspaceClosure) {
  const fixtureManifest = await readJson(resolve(fixtureRoot, 'package.json'));
  const pending = [];
  for (const [, workspacePackage] of workspaceClosure) {
    for (const name of externalDependencyNames(workspacePackage.manifest)) {
      pending.push(await findInstalledPackage(name, workspacePackage.dir));
    }
  }

  const fixtureDependencies = Object.entries({
    ...(fixtureManifest.dependencies ?? {}),
    ...(fixtureManifest.devDependencies ?? {}),
  }).filter(([name]) => !name.startsWith('@riftydev/'));
  const fixtureContexts = [
    repoRoot,
    resolve(repoRoot, 'apps/playground'),
    ...workspaceClosure.map(([, workspacePackage]) => workspacePackage.dir),
  ];
  for (const [name, version] of fixtureDependencies) {
    pending.push(await resolveFixtureExternal(name, version, fixtureContexts));
  }

  const closure = new Map();
  while (pending.length > 0) {
    const dir = pending.pop();
    if (dir === undefined) continue;
    const manifest = await readJson(resolve(dir, 'package.json'));
    const existing = closure.get(manifest.name);
    if (existing !== undefined) {
      if (existing.manifest.version !== manifest.version) {
        throw new Error(
          `Offline consumer requires two ${manifest.name} versions: ${existing.manifest.version}, ${manifest.version}`,
        );
      }
      continue;
    }
    closure.set(manifest.name, { dir, manifest });
    for (const name of installedDependencyNames(manifest)) {
      try {
        pending.push(await findInstalledPackage(name, dir));
      } catch (error) {
        if (!isOptionalInstalledDependency(manifest, name)) throw error;
      }
    }
  }
  return [...closure.entries()].sort(([left], [right]) => left.localeCompare(right));
}

async function assertExtractedWorkbench() {
  const manifest = await readJson(resolve(workbenchRoot, 'package.json'));
  const expectedExports = [
    '.',
    './playground',
    './owner-worker',
    './kernel-worker',
    './node-worker',
    './dev-server-worker',
    './typescript-worker',
    './no-coi-toolchain-worker',
  ];
  const actualExports = Object.keys(manifest.exports ?? {}).sort();
  if (JSON.stringify(actualExports) !== JSON.stringify([...expectedExports].sort())) {
    throw new Error(`Packed Workbench requires eight sealed exports: ${actualExports.join(', ')}`);
  }
  const missingPaths = [];
  for (const target of Object.values(manifest.exports)) {
    const path = resolve(workbenchRoot, target);
    if ((await stat(path).catch(() => null)) === null) {
      missingPaths.push(relative(repoRoot, path));
    }
  }
  if (missingPaths.length > 0) {
    throw new Error(`Packed Workbench source exports are missing: ${missingPaths.join(', ')}`);
  }
}

async function packPackages(packages, tarballRoot) {
  const tarballs = new Map();
  for (const [name, packageEntry] of packages) {
    const before = new Set(await readdir(tarballRoot));
    await run('pnpm', ['pack', '--pack-destination', tarballRoot], {
      cwd: packageEntry.dir,
      timeoutMs: 120_000,
    });
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

async function packInstalledPackages(packages, tarballRoot, npmCacheRoot) {
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

function snapshotPackagePath(path) {
  const segments = path.split('/');
  if (segments[0] === '.bin') return null;
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`Invalid committed snapshot path: ${path}`);
  }
  if (segments[0]?.startsWith('@')) {
    if (segments.length < 3) throw new Error(`Invalid scoped snapshot package path: ${path}`);
    return {
      name: `${segments[0]}/${segments[1]}`,
      path: segments.slice(2).join('/'),
    };
  }
  if (segments.length < 2) throw new Error(`Invalid committed snapshot package path: ${path}`);
  return { name: segments[0], path: segments.slice(1).join('/') };
}

function lockfilePackageName(path) {
  const prefix = 'node_modules/';
  if (!path.startsWith(prefix)) throw new Error(`Unsupported snapshot lock path: ${path}`);
  const segments = path.slice(prefix.length).split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`Packed consumer snapshot requires a flat package tree: ${path}`);
  }
  if (segments[0]?.startsWith('@') && segments.length === 2) {
    return `${segments[0]}/${segments[1]}`;
  }
  if (segments.length === 1) return segments[0];
  throw new Error(`Packed consumer snapshot requires a flat package tree: ${path}`);
}

async function materializeSnapshotPackages(snapshotRoot) {
  const compressed = await readFile(viteSnapshot);
  const snapshot = JSON.parse(String(await gunzipAsync(compressed)));
  if (snapshot.version !== 3 || snapshot.templateId !== 'vite') {
    throw new Error('Packed consumer requires the committed Vite snapshot v3');
  }
  const lockfile = JSON.parse(snapshot.lockfile);
  const expected = new Map();
  for (const [path, entry] of Object.entries(lockfile.packages ?? {})) {
    if (path.length === 0) continue;
    const name = lockfilePackageName(path);
    if (expected.has(name)) {
      throw new Error(`Packed consumer snapshot contains duplicate ${name}`);
    }
    expected.set(name, { version: entry.version, integrity: entry.integrity });
  }

  const manifestCandidates = new Map();
  for (const file of snapshot.nodeModules?.files ?? []) {
    const packagePath = snapshotPackagePath(file.path);
    if (packagePath === null || !expected.has(packagePath.name)) continue;
    if (file.encoding !== 'base64' || typeof file.content !== 'string') {
      throw new Error(`Unsupported committed snapshot encoding for ${file.path}`);
    }
    const packageRoot = resolve(snapshotRoot, ...packagePath.name.split('/'));
    const target = resolve(packageRoot, packagePath.path);
    if (!target.startsWith(`${packageRoot}/`)) {
      throw new Error(`Committed snapshot path escapes ${packagePath.name}: ${file.path}`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(file.content, 'base64'));
    if (packagePath.path.endsWith('package.json')) {
      const candidates = manifestCandidates.get(packagePath.name) ?? [];
      candidates.push(target);
      manifestCandidates.set(packagePath.name, candidates);
    }
  }

  const packages = new Map();
  for (const [name, source] of [...expected.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    let matched;
    for (const candidate of manifestCandidates.get(name) ?? []) {
      const manifest = await readJson(candidate);
      if (manifest.name === name && manifest.version === source.version) {
        matched = { dir: dirname(candidate), manifest };
        break;
      }
    }
    if (matched === undefined) {
      throw new Error(`Committed snapshot package mismatch for ${name}@${String(source.version)}`);
    }
    packages.set(name, matched);
  }
  return packages;
}

function tarballIntegrity(bytes) {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

async function browserRegistryPackages(options) {
  const snapshotPackages = await materializeSnapshotPackages(options.packageRoot);
  const assetManifest = await readJson(esbuildWasmManifest);
  if (assetManifest.name !== 'esbuild-wasm' || assetManifest.version !== '0.28.0') {
    throw new Error(
      `Packed consumer registry asset drifted: ${String(assetManifest.name)}@${String(assetManifest.version)}`,
    );
  }
  snapshotPackages.set('esbuild-wasm', {
    dir: dirname(esbuildWasmManifest),
    manifest: assetManifest,
  });
  const tarballs = await packInstalledPackages(
    [...snapshotPackages.entries()],
    options.tarballRoot,
    options.npmCacheRoot,
  );
  const packages = new Map();
  for (const [name, packageEntry] of snapshotPackages) {
    const tarball = tarballs.get(name);
    if (tarball === undefined) throw new Error(`Missing browser-registry tarball for ${name}`);
    const bytes = await readFile(tarball);
    packages.set(name, {
      name,
      manifest: packageEntry.manifest,
      tarball,
      integrity: tarballIntegrity(bytes),
      shasum: createHash('sha1').update(bytes).digest('hex'),
    });
  }
  return packages;
}

function listen(server, port = 0) {
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

function closeServer(server) {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error === undefined ? resolveClose() : rejectClose(error)));
  });
}

function sendResponse(request, response, status, headers, body) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    ...headers,
  });
  if (request.method === 'HEAD' || body === undefined) response.end();
  else response.end(body);
}

async function startBrowserRegistry(packages) {
  const requests = [];
  const responses = [];
  let origin = '';
  const tarballRoutes = new Map();
  const server = createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url ?? '/', origin || 'http://127.0.0.1');
      requests.push(`${request.method ?? 'GET'} ${requestUrl.pathname}`);
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
        responses.push({
          kind: 'tarball',
          packageName: tarballPackage.name,
          status: 200,
        });
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
      const packageEntry = packages.get(name);
      if (packageEntry === undefined) {
        sendResponse(request, response, 404, { 'Content-Type': 'application/json' }, '{}');
        return;
      }
      const version = packageEntry.manifest.version;
      const tarballPath = [...tarballRoutes.entries()].find(
        ([, entry]) => entry === packageEntry,
      )?.[0];
      if (tarballPath === undefined) throw new Error(`Missing registry tarball route for ${name}`);
      const manifest = {
        ...packageEntry.manifest,
        dist: {
          tarball: `${origin}${tarballPath}`,
          integrity: packageEntry.integrity,
          shasum: packageEntry.shasum,
        },
      };
      const body = Buffer.from(
        JSON.stringify({
          _id: name,
          name,
          'dist-tags': { latest: version },
          versions: { [version]: manifest },
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
  const registryResource = resources.register(async () => {
    await withDeadline(
      listening.catch(() => {}),
      5_000,
      'Packed consumer registry did not settle before cleanup',
    );
    if (!server.listening) return;
    server.closeAllConnections();
    await withDeadline(
      closeServer(server),
      5_000,
      'Packed consumer registry did not close during cleanup',
    );
  });
  await listening;
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Packed consumer registry did not bind a TCP port');
  }
  origin = `http://127.0.0.1:${address.port}`;
  for (const [name, packageEntry] of packages) {
    const tarballPath = `/-/tarballs/${encodeURIComponent(name)}-${packageEntry.manifest.version}.tgz`;
    tarballRoutes.set(tarballPath, packageEntry);
  }
  server.unref();
  return {
    origin,
    requests,
    responses,
    close: () => registryResource.cleanup(),
  };
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function withDeadline(promise, timeoutMs, message) {
  const timeout = Symbol('timeout');
  const result = await Promise.race([promise, delay(timeoutMs).then(() => timeout)]);
  if (result === timeout) throw new Error(message);
  return result;
}

async function runCleanups(label, cleanups) {
  const errors = [];
  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, label);
}

async function reserveLoopbackPort() {
  const server = createServer();
  const listening = listen(server);
  const reservation = resources.register(async () => {
    await withDeadline(
      listening.catch(() => {}),
      5_000,
      'Packed consumer port reservation did not settle before cleanup',
    );
    if (server.listening) {
      await withDeadline(
        closeServer(server),
        5_000,
        'Packed consumer port reservation did not close during cleanup',
      );
    }
  });
  await listening;
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Packed consumer port reservation did not bind a TCP port');
  }
  const port = address.port;
  await reservation.cleanup();
  return port;
}

function startProcess(command, args, options) {
  console.log(`$ ${command} ${args.join(' ')}  # cwd=${relative(repoRoot, options.cwd) || '.'}`);
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      CI: '1',
      COREPACK_ENABLE_NETWORK: '0',
      ...(options.env ?? {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let completed = false;
  let resolveExit;
  const exit = new Promise((resolve) => {
    resolveExit = resolve;
  });
  const processResource = resources.register(async () => {
    if (completed) return;
    child.kill('SIGTERM');
    await Promise.race([exit, delay(5_000)]);
    if (!completed) child.kill('SIGKILL');
    await withDeadline(exit, 5_000, `${command} did not close after SIGKILL`);
  });
  child.stdout.on('data', (chunk) => {
    output = appendBounded(output, chunk);
  });
  child.stderr.on('data', (chunk) => {
    output = appendBounded(output, chunk);
  });
  child.on('error', (error) => {
    completed = true;
    processResource.disarm();
    resolveExit({ error });
  });
  child.on('close', (code, signal) => {
    completed = true;
    processResource.disarm();
    resolveExit({ code, signal });
  });
  return {
    output: () => output,
    exit,
    completed: () => completed,
    stop: () => processResource.cleanup(),
  };
}

async function waitForHttp(url, process, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (process.completed()) {
      const result = await process.exit;
      throw new Error(
        `Packed consumer preview exited before readiness: ${JSON.stringify(result)}\n${process.output()}`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Loopback server has not accepted yet.
    }
    await delay(100);
  }
  throw new Error(`Packed consumer preview did not become ready at ${url}\n${process.output()}`);
}

async function waitForHmrBridge(app, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await app.evaluate(() => globalThis.__riftyWsBridgeOpen === true)) return;
    await delay(100);
  }
  throw new Error('Packed Workbench preview HMR bridge did not open');
}

async function writePackedConsumerManifest(consumerRoot, tarballs) {
  const manifestPath = resolve(consumerRoot, 'package.json');
  const manifest = await readJson(manifestPath);
  const dependencies = { ...(manifest.dependencies ?? {}) };
  for (const [name, tarball] of tarballs) {
    dependencies[name] = `file:../tarballs/${basename(tarball)}`;
  }
  const devDependencies = Object.fromEntries(
    Object.entries(manifest.devDependencies ?? {}).filter(([name]) => !tarballs.has(name)),
  );
  const { devDependencies: _originalDevDependencies, ...baseManifest } = manifest;
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        ...baseManifest,
        dependencies,
        ...(Object.keys(devDependencies).length === 0 ? {} : { devDependencies }),
      },
      null,
      2,
    )}\n`,
  );
}

function publishedExportTarget(value) {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null) return null;
  return value.import ?? value.default ?? null;
}

async function javascriptFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined) continue;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path);
    }
  }
  return files;
}

async function assertFirstPartyImportsStayExternal(installedRoot, manifest) {
  const expected = new Set(
    Object.keys(manifest.dependencies ?? {}).filter((name) => name.startsWith('@riftydev/')),
  );
  const actual = new Set();
  for (const path of await javascriptFiles(resolve(installedRoot, 'dist'))) {
    const source = await readFile(path, 'utf8');
    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const inspect = (node) => {
      let specifier;
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier !== undefined &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      ) {
        specifier = node.moduleSpecifier.text;
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length > 0 &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        specifier = node.arguments[0].text;
      }
      if (specifier?.startsWith('@riftydev/')) {
        const [scope, packageSegment] = specifier.split('/');
        if (packageSegment !== undefined) actual.add(`${scope}/${packageSegment}`);
      }
      ts.forEachChild(node, inspect);
    };
    inspect(sourceFile);
  }
  assertExactFirstPartyImports(expected, actual);
}

async function assertTarballInstall(consumerRoot, tarballs) {
  const manifest = await readJson(resolve(consumerRoot, 'package.json'));
  const invalidSpecs = Object.entries({
    ...(manifest.dependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
  }).filter(
    ([, specifier]) =>
      typeof specifier !== 'string' || !/^file:\.\.\/tarballs\/[^/]+\.tgz$/u.test(specifier),
  );
  if (invalidSpecs.length > 0) {
    throw new Error(`Non-tarball consumer dependencies: ${JSON.stringify(invalidSpecs)}`);
  }

  const nodeModulesRoot = resolve(consumerRoot, 'node_modules');
  const nodeModulesRealRoot = await realpath(nodeModulesRoot);
  for (const [name] of tarballs) {
    const installedRoot = resolve(nodeModulesRoot, ...name.split('/'));
    if ((await lstat(installedRoot)).isSymbolicLink()) {
      throw new Error(`Packed consumer installed ${name} as a symbolic link`);
    }
    const installedRealPath = await realpath(installedRoot);
    if (!installedRealPath.startsWith(`${nodeModulesRealRoot}/`)) {
      throw new Error(`Packed consumer resolved ${name} outside node_modules`);
    }
    const installedManifest = await readJson(resolve(installedRoot, 'package.json'));
    const workspaceSpecs = Object.values(installedManifest.dependencies ?? {}).filter(
      (specifier) => typeof specifier === 'string' && specifier.startsWith('workspace:'),
    );
    if (workspaceSpecs.length > 0) {
      throw new Error(`Packed ${name} retained workspace dependencies`);
    }
    if (
      name.startsWith('@riftydev/') &&
      (await stat(resolve(installedRoot, 'src')).catch(() => null)) !== null
    ) {
      throw new Error(`Packed ${name} unexpectedly shipped workspace sources`);
    }
  }

  const installedWorkbenchRoot = resolve(nodeModulesRoot, '@riftydev/workbench');
  const installedWorkbench = await readJson(resolve(installedWorkbenchRoot, 'package.json'));
  for (const [specifier, value] of Object.entries(installedWorkbench.exports ?? {})) {
    const target = publishedExportTarget(value);
    if (typeof target !== 'string' || !target.startsWith('./dist/')) {
      throw new Error(`Packed Workbench export ${specifier} does not target dist`);
    }
    await stat(resolve(installedWorkbenchRoot, target));
  }
  await assertFirstPartyImportsStayExternal(installedWorkbenchRoot, installedWorkbench);

  const lockfile = await readJson(resolve(consumerRoot, 'package-lock.json'));
  const invalidResolutions = Object.entries(lockfile.packages ?? {}).flatMap(
    ([packagePath, packageEntry]) => {
      if (packageEntry?.link === true) return [[packagePath, 'link']];
      const resolved = packageEntry?.resolved;
      return typeof resolved === 'string' && /^(?:https?:|link:|workspace:)/u.test(resolved)
        ? [[packagePath, resolved]]
        : [];
    },
  );
  if (invalidResolutions.length > 0) {
    throw new Error(
      `Packed consumer lockfile contains link or network resolutions: ${JSON.stringify(invalidResolutions)}`,
    );
  }
}

function assertHostAsset(url, origin, packageName) {
  const parsed = new URL(url, origin);
  if (parsed.origin !== origin || !parsed.pathname.endsWith('.wasm')) {
    throw new Error(`Packed Workbench ${packageName} host asset is invalid: ${url}`);
  }
  return parsed.href;
}

function isExpectedNativeUpdate(payload) {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    payload.type === 'update' &&
    Array.isArray(payload.updates) &&
    payload.updates.some(
      (update) =>
        typeof update === 'object' &&
        update !== null &&
        update.path === '/src/main.ts' &&
        update.acceptedPath === '/src/message.ts',
    )
  );
}

function assertHmrProof(proof) {
  if (proof.sentinel !== proof.expectedSentinel) {
    throw new Error('Packed Workbench HMR replaced the preview document');
  }
  if (proof.beforeUnload !== null) {
    throw new Error('Packed Workbench HMR fired beforeunload');
  }
  if (!proof.messages.some(isExpectedNativeUpdate)) {
    throw new Error(
      `Packed Workbench missed Vite native update provenance: ${JSON.stringify(proof.messages)}`,
    );
  }
}

async function runChromiumJourney(consumerRoot, registryPackages) {
  const registry = await startBrowserRegistry(registryPackages);
  const previewPort = await reserveLoopbackPort();
  const previewOrigin = `http://127.0.0.1:${previewPort}`;
  const preview = startProcess(
    resolve(consumerRoot, 'node_modules/.bin/vite'),
    ['preview', '--host', '127.0.0.1', '--port', String(previewPort), '--strictPort'],
    {
      cwd: consumerRoot,
      env: { RIFTY_PACKED_CONSUMER_REGISTRY_TARGET: registry.origin },
    },
  );
  let browser;
  let browserResource;
  try {
    await waitForHttp(previewOrigin, preview, 60_000);
    const { chromium } = await import('@playwright/test');
    const browserLaunch = chromium.launch({ headless: true, timeout: 10_000 });
    browserResource = resources.register(async () => {
      const launched = await withDeadline(
        browserLaunch.catch(() => undefined),
        10_000,
        'Packed consumer Chromium launch did not settle during cleanup',
      );
      if (launched !== undefined) {
        await withDeadline(
          launched.close(),
          5_000,
          'Packed consumer Chromium did not close during cleanup',
        );
      }
    });
    browser = await browserLaunch;
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    const blockedUrls = [];
    const observedUrls = [];
    const allowedOrigins = new Set([previewOrigin, registry.origin]);
    context.on('request', (request) => observedUrls.push(request.url()));
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (allowedOrigins.has(url.origin) || url.protocol === 'blob:' || url.protocol === 'data:') {
        await route.continue();
        return;
      }
      blockedUrls.push(url.href);
      await route.abort('blockedbyclient');
    });

    const page = await context.newPage();
    const pageErrors = [];
    const pageConsole = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => pageConsole.push(`[${message.type()}] ${message.text()}`));
    await page.goto(previewOrigin, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    let bootWaitError = null;
    try {
      await page.waitForFunction(
        () => document.querySelector('#status')?.textContent !== 'opening packed Workbench',
        undefined,
        { timeout: 300_000 },
      );
    } catch (error) {
      bootWaitError = error;
    }
    const status = await page.locator('#status').textContent();
    if (bootWaitError !== null || status !== 'ready') {
      const failure = await page.evaluate(async (bootTimedOut) => {
        const seen = new WeakSet();
        const serialize = (value) => {
          if (!(value instanceof Error)) return { thrown: String(value) };
          if (seen.has(value)) return { name: value.name, message: '[cycle]' };
          seen.add(value);
          return {
            name: value.name,
            message: value.message,
            stack: value.stack,
            ...(value instanceof AggregateError
              ? { errors: Array.from(value.errors, serialize) }
              : {}),
            ...(value.cause === undefined ? {} : { cause: serialize(value.cause) }),
          };
        };
        if (bootTimedOut) return { pending: true };
        try {
          await window.__RIFTY_PACKED_WORKBENCH__;
          return null;
        } catch (error) {
          return serialize(error);
        }
      }, bootWaitError !== null);
      const diagnostics = await page.evaluate(() => window.__RIFTY_PACKED_WORKBENCH_DIAGNOSTICS__);
      throw new Error(
        `Packed Workbench Chromium boot failed: ${String(status)}\n${JSON.stringify(failure)}\nDiagnostics:\n${JSON.stringify(diagnostics)}\nPage errors:\n${pageErrors.join('\n')}\nPage console:\n${pageConsole.join('\n')}\nObserved URLs:\n${observedUrls.join('\n')}\nBlocked URLs:\n${blockedUrls.join('\n')}`,
      );
    }
    const acceptance = await page.evaluate(async () => {
      const opened = await window.__RIFTY_PACKED_WORKBENCH__;
      return {
        previewUrl: opened.previewUrl,
        sqliteProof: opened.sqliteProof,
        companionLoaded: opened.companionLoaded,
        sdkLoaded: opened.sdkLoaded,
        noCoiToolchainWorkerUrl: opened.noCoiToolchainWorkerUrl,
        typescriptWorkerUrl: opened.typescriptWorkerUrl,
        hostWasm: opened.hostWasm,
        crossOriginIsolated: globalThis.crossOriginIsolated,
        serviceWorkerControlled: navigator.serviceWorker.controller !== null,
      };
    });
    if (!acceptance.crossOriginIsolated) {
      throw new Error('Packed Workbench Chromium document is not cross-origin isolated');
    }
    if (!acceptance.serviceWorkerControlled) {
      throw new Error('Packed Workbench Chromium document is not service-worker controlled');
    }
    if (!acceptance.companionLoaded) {
      throw new Error('Packed Workbench playground export did not load');
    }
    if (!acceptance.sdkLoaded) {
      throw new Error('Packed SDK root export did not load');
    }
    if (!acceptance.sqliteProof.includes('packed-sqlite-42')) {
      throw new Error(`Packed Workbench sqlite proof was lost: ${acceptance.sqliteProof}`);
    }
    const hostWasmUrls = [
      assertHostAsset(acceptance.hostWasm.quickjs, previewOrigin, 'QuickJS'),
      assertHostAsset(acceptance.hostWasm.sqlite, previewOrigin, 'sql.js'),
    ];
    if (new URL(acceptance.typescriptWorkerUrl, previewOrigin).origin !== previewOrigin) {
      throw new Error('Packed Workbench TypeScript worker did not resolve from the packed host');
    }
    if (new URL(acceptance.noCoiToolchainWorkerUrl, previewOrigin).origin !== previewOrigin) {
      throw new Error('Packed no-COI toolchain Worker did not resolve from the packed host');
    }
    for (const assetUrl of hostWasmUrls) {
      if (!observedUrls.includes(assetUrl)) {
        throw new Error(`Packed Workbench did not fetch host WASM asset ${assetUrl}`);
      }
    }
    const retiredHostEsbuildRequests = observedUrls.filter((url) => {
      try {
        return new URL(url).pathname.endsWith('/esbuild.wasm');
      } catch {
        return false;
      }
    });
    if (retiredHostEsbuildRequests.length > 0) {
      throw new Error(
        `Packed Workbench fetched retired host esbuild assets:\n${retiredHostEsbuildRequests.join('\n')}`,
      );
    }

    const previewFrame = page.frameLocator('#preview');
    const app = previewFrame.locator('#app');
    await app.waitFor({ state: 'visible', timeout: 120_000 });
    await page.waitForFunction(
      () =>
        document.querySelector('#preview')?.contentDocument?.querySelector('#app')?.textContent ===
        'packed-consumer-ready',
      undefined,
      { timeout: 120_000 },
    );
    const initialMessage = await app.textContent();
    if (initialMessage !== 'packed-consumer-ready') {
      throw new Error(`Packed Workbench Chromium rendered ${JSON.stringify(initialMessage)}`);
    }
    await waitForHmrBridge(app, 30_000);
    const hmrProofKey = `rifty:packed-consumer-hmr:${Date.now()}`;
    const expectedSentinel = await app.evaluate((_, key) => {
      const sentinel = `${key}:${Math.random()}`;
      globalThis.__riftyPackedHmrSentinel = sentinel;
      localStorage.removeItem(`${key}:beforeunload`);
      localStorage.setItem(`${key}:messages`, '[]');
      globalThis.addEventListener(
        'beforeunload',
        () => localStorage.setItem(`${key}:beforeunload`, '1'),
        { once: true },
      );
      globalThis.addEventListener('rifty:ws:message', (event) => {
        const messagesKey = `${key}:messages`;
        const messages = JSON.parse(localStorage.getItem(messagesKey) ?? '[]');
        messages.push(event.detail);
        localStorage.setItem(messagesKey, JSON.stringify(messages));
      });
      return sentinel;
    }, hmrProofKey);
    const updatedMessage = `packed-consumer-hmr-${Date.now()}`;
    await page.evaluate(
      async (message) => (await window.__RIFTY_PACKED_WORKBENCH__).writeMessage(message),
      updatedMessage,
    );
    await page.waitForFunction(
      (message) =>
        document.querySelector('#preview')?.contentDocument?.querySelector('#app')?.textContent ===
        message,
      updatedMessage,
      { timeout: 60_000 },
    );
    const hmrProof = await app.evaluate(
      (_, key) => ({
        sentinel: globalThis.__riftyPackedHmrSentinel ?? null,
        beforeUnload: localStorage.getItem(`${key}:beforeunload`),
        messages: JSON.parse(localStorage.getItem(`${key}:messages`) ?? '[]'),
      }),
      hmrProofKey,
    );
    assertHmrProof({ expectedSentinel, ...hmrProof });

    await page.evaluate(async () => (await window.__RIFTY_PACKED_WORKBENCH__).close());
    if (pageErrors.length > 0) {
      throw new Error(`Packed Workbench Chromium page errors:\n${pageErrors.join('\n')}`);
    }
    if (blockedUrls.length > 0) {
      throw new Error(
        `Packed Workbench Chromium attempted external URLs:\n${blockedUrls.join('\n')}`,
      );
    }
    for (const name of ['vite', 'esbuild-wasm']) {
      for (const kind of ['packument', 'tarball']) {
        if (
          !registry.responses.some(
            (response) => response.packageName === name && response.kind === kind,
          )
        ) {
          throw new Error(`Packed Workbench missed real ${name} ${kind} response`);
        }
      }
    }
    if (registry.responses.some((response) => response.packageName === '@esbuild/wasi-preview1')) {
      throw new Error('Packed Workbench requested the retired @esbuild/wasi-preview1 alias');
    }
    await context.close();
    console.log('Packed Workbench Chromium passed: Vite 7.3.6 preview + native HMR + sqlite');
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.stack : String(error)}\nPacked consumer preview output:\n${preview.output()}\nRegistry requests:\n${registry.requests.join('\n')}`,
    );
  } finally {
    await runCleanups('Packed consumer browser cleanup failed', [
      () => browserResource?.cleanup(),
      () => preview.stop(),
      () => registry.close(),
    ]);
  }
}

async function main() {
  await assertExtractedWorkbench();
  const workspaceClosure = await packedDependencyClosure();
  const externalClosure = await externalDependencyClosure(workspaceClosure);
  const tempRootPromise = mkdtemp(join(tmpdir(), 'rifty-workbench-packed-consumer-'));
  resources.register(async () => {
    const path = await tempRootPromise.catch(() => undefined);
    if (path === undefined) return;
    if (keepTemp) console.log(`Kept packed-consumer temp directory: ${path}`);
    else {
      await withDeadline(
        rm(path, { recursive: true, force: true }),
        20_000,
        `Packed consumer temp directory did not delete during cleanup: ${path}`,
      );
    }
  });
  const tempRoot = await tempRootPromise;
  const tarballRoot = resolve(tempRoot, 'tarballs');
  const consumerRoot = resolve(tempRoot, 'consumer');
  const npmCacheRoot = resolve(tempRoot, 'npm-cache');
  const npmPackCacheRoot = resolve(tempRoot, 'npm-pack-cache');
  const browserTarballRoot = resolve(tempRoot, 'browser-tarballs');
  const browserPackageRoot = resolve(tempRoot, 'browser-packages');
  const browserPackCacheRoot = resolve(tempRoot, 'browser-pack-cache');
  await cp(fixtureRoot, consumerRoot, { recursive: true });
  await mkdir(tarballRoot, { recursive: true });
  await mkdir(browserTarballRoot, { recursive: true });

  let failure;
  try {
    await run(
      'pnpm',
      ['-r', '--filter', '@riftydev/sdk...', '--filter', '@riftydev/workbench...', 'run', 'build'],
      {
        timeoutMs: 600_000,
      },
    );
    const workspaceTarballs = await packPackages(workspaceClosure, tarballRoot);
    const externalTarballs = await packInstalledPackages(
      externalClosure,
      tarballRoot,
      npmPackCacheRoot,
    );
    const tarballs = new Map([...workspaceTarballs, ...externalTarballs]);
    await writePackedConsumerManifest(consumerRoot, tarballs);
    await run('npm', ['install', '--offline', '--no-audit', '--no-fund'], {
      cwd: consumerRoot,
      timeoutMs: 600_000,
      env: { npm_config_cache: npmCacheRoot, npm_config_offline: 'true' },
    });
    await assertTarballInstall(consumerRoot, tarballs);
    if (surfaceOnly) {
      const failures = [];
      for (const [script, timeoutMs] of [
        ['typecheck', 180_000],
        ['build', 300_000],
      ]) {
        try {
          await run('npm', ['run', script], { cwd: consumerRoot, timeoutMs });
        } catch (error) {
          failures.push(error instanceof Error ? error.stack : String(error));
        }
      }
      if (failures.length > 0) {
        throw new Error(`Packed toolchain surface failures:\n\n${failures.join('\n\n')}`);
      }
      await stat(resolve(consumerRoot, 'dist/main.js'));
      await stat(resolve(consumerRoot, 'dist/worker.js'));
      console.log(
        `Packed toolchain surface passed: ${workspaceTarballs.size} first-party + ${externalTarballs.size} external tarballs, strict TypeScript + generic SDK/Worker graphs`,
      );
    } else {
      await run('npm', ['run', 'typecheck'], { cwd: consumerRoot, timeoutMs: 180_000 });
      await run('npm', ['run', 'build'], { cwd: consumerRoot, timeoutMs: 300_000 });
      await stat(resolve(consumerRoot, 'dist/index.html'));
      const registryPackages = await browserRegistryPackages({
        packageRoot: browserPackageRoot,
        tarballRoot: browserTarballRoot,
        npmCacheRoot: browserPackCacheRoot,
      });
      await runChromiumJourney(consumerRoot, registryPackages);
      console.log(
        `Packed Workbench consumer passed: ${workspaceTarballs.size} first-party + ${externalTarballs.size} external tarballs, packed TypeScript/build, fresh Chromium`,
      );
    }
  } catch (error) {
    failure = error;
  }

  try {
    await resources.cleanup();
  } catch (cleanupError) {
    if (failure !== undefined) {
      throw new AggregateError([failure, cleanupError], 'Packed consumer and cleanup failed');
    }
    throw cleanupError;
  }
  if (failure !== undefined) throw failure;
}

const removeSignalHandlers = resources.installSignalHandlers(process);
void main().then(
  () => removeSignalHandlers(),
  (error) => {
    removeSignalHandlers();
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  },
);
