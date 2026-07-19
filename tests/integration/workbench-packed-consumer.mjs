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
import {
  findInstalledPackage,
  resolveDeclaredCatalogAsset,
} from './workbench-packed-consumer-catalog-asset.mjs';
import { assertPackedConsumerHmrProof } from './workbench-packed-consumer-hmr-proof.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_ROOT = resolve(REPO_ROOT, 'tests/integration/fixtures/workbench-vite-consumer');
const WORKBENCH_ROOT = resolve(REPO_ROOT, 'packages/workbench');
const SHADOW_REGISTRY_ROOT = resolve(REPO_ROOT, 'tools/shadow-registry');
const VITE_SNAPSHOT = resolve(
  REPO_ROOT,
  'apps/playground/public/snapshots/vite-node-modules.json.gz',
);
const SHADOW_ASSET_CATALOG = resolve(
  REPO_ROOT,
  'tools/shadow-registry/generated/shadow-asset-catalog.json',
);
const KEEP_TEMP = process.argv.includes('--keep');
const FIXED_REGISTRY_PORT = optionalLoopbackPort(process.env.RIFTY_PACKED_CONSUMER_REGISTRY_PORT);
const WORKER_ENTRIES = [
  'owner-worker.js',
  'kernel-worker.js',
  'node-worker.js',
  'dev-server-worker.js',
  'typescript-worker.js',
];
const TYPESCRIPT_HOST_BUILTINS = new Set(['os', 'path', 'perf_hooks', 'fs']);
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== '--keep');
if (unknownArguments.length > 0) {
  throw new Error(`Unknown packed-consumer arguments: ${unknownArguments.join(', ')}`);
}

const MAX_CAPTURED_OUTPUT = 1024 * 1024;
const gunzipAsync = promisify(gunzip);

function optionalLoopbackPort(value) {
  if (value === undefined) return 0;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid RIFTY_PACKED_CONSUMER_REGISTRY_PORT: ${value}`);
  }
  return port;
}

function appendBounded(current, chunk) {
  const next = current + String(chunk);
  return next.length <= MAX_CAPTURED_OUTPUT ? next : next.slice(-MAX_CAPTURED_OUTPUT);
}

function run(command, args, options = {}) {
  const cwd = options.cwd ?? REPO_ROOT;
  const timeoutMs = options.timeoutMs ?? 180_000;
  console.log(`$ ${command} ${args.join(' ')}  # cwd=${relative(REPO_ROOT, cwd) || '.'}`);
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
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      rejectRun(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
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

async function workspacePackages() {
  const roots = [resolve(REPO_ROOT, 'packages'), resolve(REPO_ROOT, 'tools')];
  const packages = new Map();
  for (const root of roots) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = resolve(root, entry.name);
      const manifestPath = resolve(dir, 'package.json');
      try {
        const manifest = await readJson(manifestPath);
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
  const pending = ['@riftydev/workbench'];
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
  const dependencies = Object.entries(manifest.dependencies ?? {})
    .filter(([, specifier]) => typeof specifier !== 'string' || !specifier.startsWith('workspace:'))
    .map(([name]) => name);
  return [...new Set(dependencies)];
}

function installedRuntimeDependencyNames(manifest) {
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

async function resolveFixtureExternal(name, specifier, contexts) {
  const mismatches = [];
  for (const context of contexts) {
    try {
      const dir = await findInstalledPackage(name, context);
      const manifest = await readJson(resolve(dir, 'package.json'));
      if (manifest.version === specifier) return dir;
      mismatches.push(`${manifest.version} from ${relative(REPO_ROOT, context) || '.'}`);
    } catch (error) {
      if (!String(error).includes('Cannot resolve installed package')) throw error;
    }
  }
  throw new Error(
    `Cannot resolve fixture package ${name}@${specifier} from the installed graph${
      mismatches.length === 0 ? '' : `; found ${mismatches.join(', ')}`
    }`,
  );
}

async function externalDependencyClosure(workspaceClosure) {
  const fixtureManifest = await readJson(resolve(FIXTURE_ROOT, 'package.json'));
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
    REPO_ROOT,
    resolve(REPO_ROOT, 'apps/playground'),
    ...workspaceClosure.map(([, workspacePackage]) => workspacePackage.dir),
  ];
  for (const [name, specifier] of fixtureDependencies) {
    pending.push(await resolveFixtureExternal(name, specifier, fixtureContexts));
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
          `Offline packed consumer requires two ${manifest.name} versions: ${existing.manifest.version}, ${manifest.version}`,
        );
      }
      continue;
    }
    closure.set(manifest.name, { dir, manifest });
    for (const name of installedRuntimeDependencyNames(manifest)) {
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
  const manifest = await readJson(resolve(WORKBENCH_ROOT, 'package.json'));
  const exportedSources = Object.values(manifest.exports ?? {}).map((target) =>
    resolve(WORKBENCH_ROOT, target),
  );
  const missingPaths = [];
  for (const path of exportedSources) {
    if ((await stat(path).catch(() => null)) === null) missingPaths.push(relative(REPO_ROOT, path));
  }
  if (missingPaths.length > 0) {
    throw new Error(
      `Packed Workbench consumer requires extracted package sources; missing: ${missingPaths.join(', ')}`,
    );
  }
}

async function assertPublishedWorkerBundles() {
  const distRoot = resolve(WORKBENCH_ROOT, 'dist');
  const pending = WORKER_ENTRIES.map((entry) => resolve(distRoot, entry));
  const visited = new Set();
  const failures = [];
  let bundlesTypescript = false;

  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined || visited.has(path)) continue;
    visited.add(path);
    const source = await readFile(path, 'utf8');
    if (source.includes('typescript/lib/typescript.js')) bundlesTypescript = true;
    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);

    function inspect(node) {
      if (ts.isIdentifier(node) && (node.text === '__filename' || node.text === '__dirname')) {
        failures.push(`${basename(path)} contains free ${node.text}`);
      }

      let specifier;
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier !== undefined &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      ) {
        specifier = node.moduleSpecifier.text;
      } else if (
        ts.isCallExpression(node) &&
        node.arguments.length > 0 &&
        ts.isStringLiteralLike(node.arguments[0]) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            (node.expression.text === 'require' || node.expression.text === '__require')))
      ) {
        specifier = node.arguments[0].text;
      }

      if (specifier !== undefined) {
        if (TYPESCRIPT_HOST_BUILTINS.has(specifier)) {
          failures.push(`${basename(path)} retains ${specifier}`);
        }
        if (
          specifier === '@riftydev/runtime-js' ||
          specifier.startsWith('@riftydev/runtime-js/') ||
          specifier === '@riftydev/ts-language-service' ||
          specifier.startsWith('@riftydev/ts-language-service/')
        ) {
          failures.push(`${basename(path)} externalizes ${specifier}`);
        }
        if (specifier.startsWith('.')) {
          const importedPath = resolve(dirname(path), specifier);
          if (importedPath.startsWith(`${distRoot}/`) && importedPath.endsWith('.js')) {
            pending.push(importedPath);
          }
        }
      }
      ts.forEachChild(node, inspect);
    }

    inspect(sourceFile);
  }

  if (!bundlesTypescript) failures.push('worker closure does not bundle TypeScript');
  if (failures.length > 0) {
    throw new Error(`Published Workbench worker boundary failed:\n${failures.join('\n')}`);
  }
}

async function packPackages(packages, tarballRoot) {
  const tarballs = new Map();
  for (const [name, workspacePackage] of packages) {
    const before = new Set(await readdir(tarballRoot));
    await run('pnpm', ['pack', '--pack-destination', tarballRoot], {
      cwd: workspacePackage.dir,
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
  for (const [name, installedPackage] of packages) {
    const before = new Set(await readdir(tarballRoot));
    await run(
      'npm',
      ['pack', '--ignore-scripts', '--pack-destination', tarballRoot, installedPackage.dir],
      {
        timeoutMs: 120_000,
        env: { npm_config_cache: npmCacheRoot, npm_config_offline: 'true' },
      },
    );
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
  if (segments.length < 2) throw new Error(`Invalid snapshot package path: ${path}`);
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
  const compressed = await readFile(VITE_SNAPSHOT);
  const snapshot = JSON.parse(String(await gunzipAsync(compressed)));
  if (snapshot.version !== 2 || snapshot.templateId !== 'vite') {
    throw new Error('Packed consumer requires the committed Vite snapshot v2');
  }
  const lockfile = JSON.parse(snapshot.lockfile);
  const expected = new Map();
  for (const [path, entry] of Object.entries(lockfile.packages ?? {})) {
    if (path.length === 0) continue;
    const name = lockfilePackageName(path);
    const existing = expected.get(name);
    if (existing !== undefined) {
      throw new Error(
        `Packed consumer snapshot contains duplicate ${name}: ${existing.version}, ${entry.version}`,
      );
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
    packages.set(name, { ...matched, source });
  }
  return packages;
}

function tarballIntegrity(bytes) {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

async function registryPackage(name, installedPackage, tarball, expectedIntegrity) {
  const bytes = await readFile(tarball);
  const integrity = tarballIntegrity(bytes);
  if (expectedIntegrity !== undefined && integrity !== expectedIntegrity) {
    throw new Error(
      `Packed consumer registry integrity mismatch for ${name}: expected ${expectedIntegrity}, got ${integrity}`,
    );
  }
  return {
    name,
    manifest: installedPackage.manifest,
    tarball,
    integrity,
    shasum: createHash('sha1').update(bytes).digest('hex'),
  };
}

async function browserRegistryPackages(options) {
  const snapshotPackages = await materializeSnapshotPackages(options.snapshotRoot);
  const snapshotTarballs = await packInstalledPackages(
    [...snapshotPackages.entries()],
    options.tarballRoot,
    options.npmCacheRoot,
  );
  const registryPackages = new Map();
  for (const [name, installedPackage] of snapshotPackages) {
    const tarball = snapshotTarballs.get(name);
    if (tarball === undefined) throw new Error(`Missing snapshot tarball for ${name}`);
    registryPackages.set(name, await registryPackage(name, installedPackage, tarball, undefined));
  }

  const catalog = await readJson(SHADOW_ASSET_CATALOG);
  const descriptor = catalog.assets?.find(
    (asset) => asset.source?.name === 'esbuild-wasm' && asset.source?.version === '0.28.0',
  );
  if (descriptor === undefined) {
    throw new Error('Packed consumer requires the catalog-pinned esbuild-wasm asset');
  }
  const esbuildWasm = await resolveDeclaredCatalogAsset({
    producerRoot: SHADOW_REGISTRY_ROOT,
    name: descriptor.source.name,
    version: descriptor.source.version,
    integrity: descriptor.source.integrity,
  });
  const esbuildTarball = (
    await packInstalledPackages(
      [[descriptor.source.name, esbuildWasm]],
      options.tarballRoot,
      options.npmCacheRoot,
    )
  ).get(descriptor.source.name);
  if (esbuildTarball === undefined) {
    throw new Error(`Packed consumer failed to pack ${descriptor.source.name}`);
  }
  registryPackages.set(
    descriptor.source.name,
    await registryPackage(
      descriptor.source.name,
      esbuildWasm,
      esbuildTarball,
      esbuildWasm.expectedIntegrity,
    ),
  );
  return registryPackages;
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

async function startBrowserRegistry(packages, port) {
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
          method: request.method ?? 'GET',
          path: requestUrl.pathname,
          kind: 'tarball',
          packageName: tarballPackage.name,
          status: 200,
          bodyBytes: request.method === 'HEAD' ? 0 : bytes.byteLength,
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
      const registryPackageEntry = packages.get(name);
      if (registryPackageEntry === undefined) {
        sendResponse(request, response, 404, { 'Content-Type': 'application/json' }, '{}');
        return;
      }
      const version = registryPackageEntry.manifest.version;
      const tarballPath = [...tarballRoutes.entries()].find(
        ([, entry]) => entry === registryPackageEntry,
      )?.[0];
      if (tarballPath === undefined) throw new Error(`Missing registry tarball route for ${name}`);
      const manifest = {
        ...registryPackageEntry.manifest,
        dist: {
          tarball: `${origin}${tarballPath}`,
          integrity: registryPackageEntry.integrity,
          shasum: registryPackageEntry.shasum,
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
      responses.push({
        method: request.method ?? 'GET',
        path: requestUrl.pathname,
        kind: 'packument',
        packageName: name,
        status: 200,
        bodyBytes: request.method === 'HEAD' ? 0 : body.byteLength,
      });
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
      } else response.destroy(error instanceof Error ? error : new Error(String(error)));
    });
  });
  await listen(server, port);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Packed consumer registry did not bind a TCP port');
  }
  origin = `http://127.0.0.1:${address.port}`;
  for (const [name, registryPackageEntry] of packages) {
    const tarballPath = `/-/tarballs/${encodeURIComponent(name)}-${registryPackageEntry.manifest.version}.tgz`;
    tarballRoutes.set(tarballPath, registryPackageEntry);
  }
  server.unref();
  return {
    origin,
    requests,
    responses,
    async close() {
      server.closeAllConnections();
      await closeServer(server);
    },
  };
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function reserveLoopbackPort() {
  const server = createServer();
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Packed consumer port reservation did not bind a TCP port');
  }
  const port = address.port;
  await closeServer(server);
  return port;
}

function startProcess(command, args, options) {
  console.log(`$ ${command} ${args.join(' ')}  # cwd=${relative(REPO_ROOT, options.cwd) || '.'}`);
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
  const exit = new Promise((resolveExit) => {
    child.stdout.on('data', (chunk) => {
      output = appendBounded(output, chunk);
    });
    child.stderr.on('data', (chunk) => {
      output = appendBounded(output, chunk);
    });
    child.on('error', (error) => {
      completed = true;
      resolveExit({ error });
    });
    child.on('close', (code, signal) => {
      completed = true;
      resolveExit({ code, signal });
    });
  });
  return {
    output: () => output,
    exit,
    completed: () => completed,
    async stop() {
      if (completed) return;
      child.kill('SIGTERM');
      await Promise.race([exit, delay(5_000)]);
      if (!completed) child.kill('SIGKILL');
      await exit;
    },
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
  const packedManifest = {
    ...baseManifest,
    dependencies,
    ...(Object.keys(devDependencies).length === 0 ? {} : { devDependencies }),
  };
  await writeFile(manifestPath, `${JSON.stringify(packedManifest, null, 2)}\n`);
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
      throw new Error(
        `Packed consumer resolved ${name} outside node_modules: ${installedRealPath}`,
      );
    }
    const installedManifest = await readJson(resolve(installedRoot, 'package.json'));
    const workspaceSpecs = Object.values(installedManifest.dependencies ?? {}).filter(
      (specifier) => typeof specifier === 'string' && specifier.startsWith('workspace:'),
    );
    if (workspaceSpecs.length > 0) {
      throw new Error(`Packed ${name} retained workspace dependencies`);
    }
  }

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

async function runChromiumJourney(consumerRoot, registryPackages) {
  const registry = await startBrowserRegistry(registryPackages, FIXED_REGISTRY_PORT);
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
  try {
    await waitForHttp(previewOrigin, preview, 60_000);
    const { chromium } = await import('@playwright/test');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    const blockedUrls = [];
    const allowedOrigins = new Set([previewOrigin, registry.origin]);
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
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(previewOrigin, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(
      () => document.querySelector('#status')?.textContent !== 'opening packed Workbench',
      undefined,
      { timeout: 300_000 },
    );
    const status = await page.locator('#status').textContent();
    if (status !== 'ready') {
      throw new Error(`Packed Workbench Chromium boot failed: ${String(status)}`);
    }
    const acceptance = await page.evaluate(async () => {
      const opened = await window.__RIFTY_PACKED_WORKBENCH__;
      return {
        previewUrl: opened.previewUrl,
        runtimeAssetProgress: opened.runtimeAssetProgress,
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
    const phases = acceptance.runtimeAssetProgress.map((progress) => progress.phase);
    for (const phase of ['fetch', 'verify', 'ready']) {
      if (!phases.includes(phase)) {
        throw new Error(`Packed Workbench Chromium missed runtime asset phase ${phase}`);
      }
    }
    const ready = acceptance.runtimeAssetProgress.find((progress) => progress.phase === 'ready');
    if (ready?.storageClass !== 'memory-session' || ready.assetCount !== 1) {
      throw new Error(
        `Packed Workbench Chromium returned an invalid runtime asset receipt: ${JSON.stringify(ready)}`,
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
    const expectedHmrSentinel = await app.evaluate((_, key) => {
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
    assertPackedConsumerHmrProof({
      expectedSentinel: expectedHmrSentinel,
      ...hmrProof,
    });
    await page.evaluate(async () => (await window.__RIFTY_PACKED_WORKBENCH__).close());
    if (pageErrors.length > 0) {
      throw new Error(`Packed Workbench Chromium page errors:\n${pageErrors.join('\n')}`);
    }
    if (blockedUrls.length > 0) {
      throw new Error(
        `Packed Workbench Chromium attempted external URLs:\n${blockedUrls.join('\n')}`,
      );
    }
    for (const expectedRequest of [
      'GET /vite',
      'GET /esbuild-wasm',
      'GET /-/tarballs/vite-7.3.6.tgz',
      'GET /-/tarballs/esbuild-wasm-0.28.0.tgz',
    ]) {
      if (!registry.requests.includes(expectedRequest)) {
        throw new Error(
          `Packed Workbench Chromium missed registry request ${expectedRequest}: ${JSON.stringify(registry.requests)}`,
        );
      }
    }
    const aliasResponses = registry.responses.filter(
      (response) => response.packageName === '@esbuild/wasi-preview1',
    );
    if (aliasResponses.length > 0) {
      console.log(
        `Packed Workbench alias control: ${JSON.stringify({
          origin: registry.origin,
          boundary: 'cold open through preview and native HMR ready',
          storage: 'memory-session',
          responses: aliasResponses,
          totalBodyBytes: aliasResponses.reduce((total, response) => total + response.bodyBytes, 0),
        })}`,
      );
    }
    await context.close();
    console.log(
      `Packed Workbench Chromium passed: Vite 7.3.6 preview + HMR, ${phases.join(' -> ')}`,
    );
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.stack : String(error)}\nPacked consumer preview output:\n${preview.output()}\nRegistry requests:\n${registry.requests.join('\n')}`,
    );
  } finally {
    if (browser !== undefined) await browser.close();
    await preview.stop();
    await registry.close();
  }
}

async function main() {
  await assertExtractedWorkbench();
  const workspaceClosure = await packedDependencyClosure();
  const externalClosure = await externalDependencyClosure(workspaceClosure);
  const tempRoot = await mkdtemp(join(tmpdir(), 'rifty-workbench-packed-consumer-'));
  const tarballRoot = resolve(tempRoot, 'tarballs');
  const consumerRoot = resolve(tempRoot, 'consumer');
  const npmCacheRoot = resolve(tempRoot, 'npm-cache');
  const npmPackCacheRoot = resolve(tempRoot, 'npm-pack-cache');
  const browserRegistryTarballRoot = resolve(tempRoot, 'browser-registry-tarballs');
  const browserRegistryPackageRoot = resolve(tempRoot, 'browser-registry-packages');
  const browserRegistryPackCacheRoot = resolve(tempRoot, 'browser-registry-pack-cache');
  await cp(FIXTURE_ROOT, consumerRoot, { recursive: true });
  await mkdir(tarballRoot, { recursive: true });
  await mkdir(browserRegistryTarballRoot, { recursive: true });

  try {
    await run('pnpm', ['-r', '--filter', '@riftydev/workbench...', 'run', 'build'], {
      timeoutMs: 600_000,
    });
    await assertPublishedWorkerBundles();
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
    await run('npm', ['run', 'typecheck'], { cwd: consumerRoot, timeoutMs: 180_000 });
    await run('npm', ['run', 'build'], { cwd: consumerRoot, timeoutMs: 300_000 });
    await stat(resolve(consumerRoot, 'dist/index.html'));
    const registryPackages = await browserRegistryPackages({
      snapshotRoot: browserRegistryPackageRoot,
      tarballRoot: browserRegistryTarballRoot,
      npmCacheRoot: browserRegistryPackCacheRoot,
    });
    await runChromiumJourney(consumerRoot, registryPackages);
    console.log(
      `Packed Workbench consumer passed offline: ${workspaceTarballs.size} first-party + ${externalTarballs.size} external tarballs, TypeScript, Vite production build, Chromium`,
    );
  } finally {
    if (KEEP_TEMP) console.log(`Kept packed-consumer temp directory: ${tempRoot}`);
    else await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
