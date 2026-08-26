/// <reference lib="webworker" />

import { registerNetBuiltins } from '@riftydev/net/register-builtins';
import { RegistryClient, install } from '@riftydev/npm-client';
import {
  createMemoryShadowAssetStorage,
  createOriginExclusiveShadowAssetManager,
  createRegistryShadowAssetSource,
  createShadowAssetPortClient,
  shadowAssetPlanForInstallResult,
} from '@riftydev/npm-client/internal';
import {
  awaitDrain,
  installConsole,
  installEventLoopKeepalive,
  installFetchKeepalive,
} from '@riftydev/runtime-js';
import { Buffer } from '@riftydev/runtime-js/builtins/buffer';
import { runNodeEntry } from '@riftydev/runtime-js/builtins/node-entry';
import {
  installProcessGlobals,
  riftyProcess,
  setProcessCwd,
} from '@riftydev/runtime-js/builtins/process';
import { installTimerGlobals } from '@riftydev/runtime-js/builtins/timers';
import { asyncVfs, syncMirror } from '@riftydev/vfs';
import { installMemoryFs } from '@riftydev/vfs/internal';
import { installWorkerRealmCompat } from '../../../packages/runtime-js/src/ipc/worker-realm-compat.ts';
import { finalizePackageInstallFiles } from '../../../packages/workbench/src/workers/package-install-finalizer.ts';
import {
  prepareViteCli,
  viteCliPreparationFromArgs,
} from '../../../packages/workbench/src/workers/vite-cli-prep.ts';
import { activateWorkbenchRuntimeAdapters } from '../../../packages/workbench/src/workers/workbench-runtime-adapters.ts';

declare const self: DedicatedWorkerGlobalScope;

type Phase =
  | 'unbooted'
  | 'booted'
  | 'seeded'
  | 'installed'
  | 'written'
  | 'vited'
  | 'listed'
  | 'expressed'
  | 'done'
  | 'failed';

let phase: Phase = 'unbooted';
let busy = false;
let root = '';
let registry: RegistryClient | null = null;
let installResult: Awaited<ReturnType<typeof install>> | null = null;
let pendingManifestReads = new Set<string>();
let pendingAssetReads = new Set<string>();
let activeOutput: string[] | null = null;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function post(value: unknown): void {
  self.postMessage(value);
}

function command(value: unknown, kind: string, keys: readonly string[] = []) {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${kind} command must be a plain object`);
  }
  const expected = ['kind', ...keys].toSorted();
  const actual = Object.keys(value).toSorted();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${kind} command has unexpected fields`);
  }
  if (Reflect.get(value, 'kind') !== kind) throw new TypeError(`expected ${kind} command`);
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function stringRecord(value: unknown, label: string): Readonly<Record<string, string>> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key.length === 0 || typeof entry !== 'string') {
      throw new TypeError(`${label} must contain string values`);
    }
  }
  return value as Readonly<Record<string, string>>;
}

function requirePhase(expected: Phase, kind: string): void {
  if (phase !== expected) throw new Error(`${kind} command is invalid during ${phase}`);
}

function mkdirParent(path: string): void {
  const parent = path.slice(0, path.lastIndexOf('/')) || '/';
  syncMirror().mkdirSync(parent, { recursive: true });
}

function decodeStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`${label} must be a string array`);
  }
  return value;
}

function sameStringRecord(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(left).toSorted();
  const expected = Object.keys(right).toSorted();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index] && left[key] === right[key])
  );
}

function exitCodeFromThrow(error: unknown): number | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    Reflect.get(error, 'code') === 'RIFTY_PROCESS_EXIT' &&
    typeof Reflect.get(error, 'exitCode') === 'number'
  ) {
    return Reflect.get(error, 'exitCode') as number;
  }
  return null;
}

async function capturedNodeRun(options: {
  readonly args: readonly string[];
  readonly bin: boolean;
  readonly entryPath: string;
  readonly root: string;
}): Promise<{ readonly exitCode: number; readonly rawOutput: string }> {
  const output: string[] = [];
  activeOutput = output;
  const previousStdout = riftyProcess.stdout.write;
  const previousStderr = riftyProcess.stderr.write;
  const write = (chunk: string | Uint8Array): boolean => {
    output.push(typeof chunk === 'string' ? chunk : decoder.decode(chunk));
    return true;
  };
  riftyProcess.stdout.write = write;
  riftyProcess.stderr.write = write;
  riftyProcess.argv = ['node', options.entryPath, ...options.args];
  riftyProcess.exitCode = 0;
  setProcessCwd(options.root);
  let exitCode = 0;
  try {
    await runNodeEntry({
      vfs: syncMirror(),
      entryPath: options.entryPath,
      cwd: options.root,
      bin: options.bin,
    });
    await awaitDrain({ capMs: 600_000 });
    exitCode = riftyProcess.exitCode;
  } catch (error) {
    const explicit = exitCodeFromThrow(error);
    if (explicit === null) throw error;
    exitCode = explicit;
  } finally {
    riftyProcess.stdout.write = previousStdout;
    riftyProcess.stderr.write = previousStderr;
    activeOutput = null;
  }
  return { exitCode, rawOutput: output.join('') };
}

async function activateViteRuntime(): Promise<void> {
  if (registry === null || installResult === null) throw new Error('install must complete first');
  const manager = createOriginExclusiveShadowAssetManager({
    storage: createMemoryShadowAssetStorage(),
    source: createRegistryShadowAssetSource(registry),
  });
  const ready = await manager.ensure(shadowAssetPlanForInstallResult(installResult));
  const channel = new MessageChannel();
  const server = manager.serve(ready, channel.port2);
  const client = createShadowAssetPortClient(channel.port1);
  let failure: unknown;
  try {
    await activateWorkbenchRuntimeAdapters({ assets: client, fs: syncMirror(), cwd: root });
  } catch (error) {
    failure = error;
  }
  server.dispose();
  try {
    await manager.close();
  } catch (closeError) {
    if (failure !== undefined) {
      throw new AggregateError([failure, closeError], 'runtime activation and close failed');
    }
    throw closeError;
  }
  if (failure !== undefined) throw failure;
}

async function dispatch(value: unknown): Promise<unknown> {
  const kind = typeof value === 'object' && value !== null ? Reflect.get(value, 'kind') : undefined;
  if (kind === 'boot') {
    command(value, 'boot');
    requirePhase('unbooted', 'boot');
    installProcessGlobals();
    installTimerGlobals();
    installWorkerRealmCompat();
    (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
    installEventLoopKeepalive();
    installFetchKeepalive();
    installConsole({
      stdout: (chunk) => activeOutput?.push(chunk),
      stderr: (chunk) => activeOutput?.push(chunk),
    });
    installMemoryFs();
    registerNetBuiltins();
    phase = 'booted';
    return { kind: 'booted', backend: 'memory' };
  }
  if (kind === 'seed') {
    const input = command(value, 'seed', ['files', 'root']);
    requirePhase('booted', 'seed');
    root = nonEmptyString(input.root, 'seed root');
    if (root !== '/bench') throw new TypeError('seed root must be /bench');
    const files = stringRecord(input.files, 'seed files');
    const paths = Object.entries(files).map(([path, source]) => {
      const target = `${root}${path}`;
      mkdirParent(target);
      syncMirror().writeFileSync(target, encoder.encode(source));
      return target;
    });
    phase = 'seeded';
    return { kind: 'seeded', paths: paths.toSorted() };
  }
  if (kind === 'install') {
    const input = command(value, 'install', ['dependencies', 'registryUrl', 'root']);
    requirePhase('seeded', 'install');
    if (input.root !== root) throw new TypeError('install root does not match seed root');
    const dependencies = stringRecord(input.dependencies, 'install dependencies');
    const packageJson = JSON.parse(
      decoder.decode(syncMirror().readFileBytesSync(`${root}/package.json`)),
    ) as {
      readonly dependencies?: unknown;
    };
    const seededDependencies = stringRecord(packageJson.dependencies, 'seeded dependencies');
    if (!sameStringRecord(dependencies, seededDependencies)) {
      throw new TypeError('install dependencies do not match seeded package.json');
    }
    const vfs = asyncVfs();
    if (vfs === null) throw new Error('Memory VFS async surface is missing');
    registry = new RegistryClient({ baseUrl: nonEmptyString(input.registryUrl, 'registryUrl') });
    installResult = await install({ vfs, cwd: root, registry });
    await finalizePackageInstallFiles({ root });
    await activateViteRuntime();
    pendingManifestReads = new Set(
      Object.keys(dependencies).map(
        (dependency) => `${root}/node_modules/${dependency}/package.json`,
      ),
    );
    phase = 'installed';
    return { kind: 'installed' };
  }
  if (kind === 'read') {
    const input = command(value, 'read', ['path']);
    const path = nonEmptyString(input.path, 'read path');
    if (phase === 'installed') {
      if (!pendingManifestReads.delete(path))
        throw new TypeError('unexpected installed manifest read');
    } else if (phase === 'listed') {
      if (!pendingAssetReads.delete(path)) throw new TypeError('unexpected emitted asset read');
    } else {
      throw new Error(`read command is invalid during ${phase}`);
    }
    return { kind: 'read', path, text: decoder.decode(syncMirror().readFileBytesSync(path)) };
  }
  if (kind === 'write') {
    const input = command(value, 'write', ['contents', 'path']);
    requirePhase('installed', 'write');
    if (pendingManifestReads.size !== 0) throw new Error('installed manifests must be read first');
    const path = nonEmptyString(input.path, 'write path');
    if (path !== `${root}/src/Panel.jsx`) throw new TypeError('write path must be canonical Panel');
    syncMirror().writeFileSync(
      path,
      encoder.encode(nonEmptyString(input.contents, 'write contents')),
    );
    phase = 'written';
    return { kind: 'written', path };
  }
  if (kind === 'vite') {
    const input = command(value, 'vite', ['args', 'entryPath', 'root']);
    requirePhase('written', 'vite');
    if (input.root !== root) throw new TypeError('Vite root does not match seed root');
    const entryPath = nonEmptyString(input.entryPath, 'Vite entryPath');
    if (entryPath !== `${root}/node_modules/.bin/vite`) {
      throw new TypeError('Vite entryPath must be the installed .bin shim');
    }
    const args = decodeStringArray(input.args, 'Vite args');
    if (args.length !== 1 || args[0] !== 'build') throw new TypeError('Vite args must be build');
    const preparation = viteCliPreparationFromArgs({
      root,
      args,
      executedBinPath: entryPath,
    });
    if (preparation === null) throw new Error('installed Vite command did not produce preparation');
    await prepareViteCli(preparation);
    const outcome = await capturedNodeRun({ args, bin: true, entryPath, root });
    phase = 'vited';
    return { kind: 'vite', ...outcome };
  }
  if (kind === 'readdir') {
    const input = command(value, 'readdir', ['path']);
    requirePhase('vited', 'readdir');
    const path = nonEmptyString(input.path, 'readdir path');
    if (path !== `${root}/dist/assets`) throw new TypeError('readdir path must be Vite assets');
    const paths = syncMirror()
      .readdirSync(path)
      .map((entry) => `${path}/${typeof entry === 'string' ? entry : entry.name}`)
      .toSorted();
    pendingAssetReads = new Set(paths.filter((entry) => entry.endsWith('.js')));
    phase = 'listed';
    return { kind: 'entries', paths };
  }
  if (kind === 'express') {
    const input = command(value, 'express', ['entryPath', 'marker', 'root']);
    requirePhase('listed', 'express');
    if (pendingAssetReads.size !== 0) throw new Error('emitted JavaScript must be read first');
    if (input.root !== root) throw new TypeError('Express root does not match seed root');
    const entryPath = nonEmptyString(input.entryPath, 'Express entryPath');
    if (entryPath !== `${root}/express-anchor.cjs`) {
      throw new TypeError('Express entryPath must be canonical');
    }
    const marker = nonEmptyString(input.marker, 'Express marker');
    const outcome = await capturedNodeRun({ args: [marker], bin: false, entryPath, root });
    phase = 'expressed';
    return { kind: 'express', ...outcome };
  }
  if (kind === 'finish') {
    command(value, 'finish');
    requirePhase('expressed', 'finish');
    phase = 'done';
    return { kind: 'finished' };
  }
  throw new TypeError(`unsupported in-realm Worker command ${JSON.stringify(kind)}`);
}

function errorEnvelope(error: unknown): {
  readonly name: string;
  readonly message: string;
  readonly stack: string;
} {
  const inspected = error instanceof Error ? error : new Error(String(error));
  return {
    name: inspected.name,
    message: inspected.message,
    stack: inspected.stack ?? `${inspected.name}: ${inspected.message}`,
  };
}

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (busy || phase === 'failed' || phase === 'done') {
    phase = 'failed';
    post({ kind: 'error', error: errorEnvelope(new Error('in-realm Worker command overlap')) });
    return;
  }
  busy = true;
  void dispatch(event.data).then(
    (reply) => {
      busy = false;
      post(reply);
      if (
        typeof reply === 'object' &&
        reply !== null &&
        Reflect.get(reply, 'kind') === 'finished'
      ) {
        self.close();
      }
    },
    (error: unknown) => {
      busy = false;
      phase = 'failed';
      post({ kind: 'error', error: errorEnvelope(error) });
    },
  );
});

post({ kind: 'ready' });
