import {
  childFsScenario,
  childFsScenarioIdentity,
} from '../../../tools/perf/child-fs/scenario.mjs';
import { validateChildFsRawSample } from '../../../tools/perf/src/child-fs-artifact.mjs';
import workerUrl from './child-fs-in-realm-worker.ts?worker&url';

interface WorkerEndpoint {
  addEventListener(type: 'error' | 'message' | 'messageerror', listener: EventListener): void;
  removeEventListener(type: 'error' | 'message' | 'messageerror', listener: EventListener): void;
  postMessage(message: unknown): void;
  terminate(): void;
}

export interface ChildFsInRealmLaneHost {
  readonly open: (url: string) => WorkerEndpoint;
}

interface PendingReply<T> {
  readonly decode: (value: unknown) => T;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const actual = Object.keys(value).toSorted();
  const expected = [...keys].toSorted();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} has unexpected fields: ${actual.join(', ')}`);
  }
  return value as Record<string, unknown>;
}

function exactKind(value: unknown, kind: string, keys: readonly string[] = []) {
  const reply = record(value, ['kind', ...keys], `${kind} reply`);
  if (reply.kind !== kind) throw new TypeError(`expected ${kind} reply`);
  return reply;
}

function exactString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function exactZero(value: unknown, label: string): 0 {
  if (value !== 0) throw new TypeError(`${label} must be exit code 0`);
  return 0;
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`${label} must be a string array`);
  }
  return value;
}

function equalStrings(actual: readonly string[], expected: readonly string[], label: string): void {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new TypeError(`${label} does not match the request`);
  }
}

function workerFailure(value: unknown): Error | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Reflect.get(value, 'kind') !== 'error'
  ) {
    return null;
  }
  const reply = exactKind(value, 'error', ['error']);
  const envelope = record(reply.error, ['message', 'name', 'stack'], 'Worker error envelope');
  const error = new Error(exactString(envelope.message, 'Worker error message'));
  error.name = exactString(envelope.name, 'Worker error name');
  error.stack = exactString(envelope.stack, 'Worker error stack');
  return error;
}

class SingleFlightWorkerSession {
  readonly #endpoint: WorkerEndpoint;
  #pending: PendingReply<unknown> | null = null;
  #terminalError: unknown;

  constructor(endpoint: WorkerEndpoint) {
    this.#endpoint = endpoint;
    endpoint.addEventListener('message', this.#onMessage);
    endpoint.addEventListener('messageerror', this.#onMessageError);
    endpoint.addEventListener('error', this.#onError);
  }

  readonly #onMessage = (event: Event): void => {
    const value = (event as MessageEvent<unknown>).data;
    let failure: Error | null;
    try {
      failure = workerFailure(value);
    } catch (error) {
      this.#fail(error);
      return;
    }
    if (failure !== null) {
      this.#fail(failure);
      return;
    }
    const pending = this.#pending;
    if (pending === null) {
      this.#fail(new Error('in-realm Worker sent a duplicate or out-of-order reply'));
      return;
    }
    this.#pending = null;
    try {
      pending.resolve(pending.decode(value));
    } catch (error) {
      this.#terminalError = error;
      pending.reject(error);
    }
  };

  readonly #onMessageError = (): void => {
    this.#fail(new Error('in-realm Worker message could not be deserialized'));
  };

  readonly #onError = (event: Event): void => {
    const inspected = event as ErrorEvent;
    this.#fail(
      inspected.error instanceof Error
        ? inspected.error
        : new Error(inspected.message || 'in-realm Worker crashed'),
    );
  };

  #fail(error: unknown): void {
    if (this.#terminalError !== undefined) return;
    this.#terminalError = error;
    const pending = this.#pending;
    this.#pending = null;
    pending?.reject(error);
  }

  #healthy(): void {
    if (this.#terminalError !== undefined) throw this.#terminalError;
  }

  async receive<T>(decode: (value: unknown) => T): Promise<T> {
    return await this.#wait(decode);
  }

  async send<T>(command: unknown, decode: (value: unknown) => T): Promise<T> {
    this.#healthy();
    const reply = this.#wait(decode);
    this.#endpoint.postMessage(command);
    return await reply;
  }

  async #wait<T>(decode: (value: unknown) => T): Promise<T> {
    this.#healthy();
    if (this.#pending !== null) throw new Error('in-realm Worker command overlap');
    const reply = new Promise<T>((resolve, reject) => {
      this.#pending = { decode, resolve, reject } as PendingReply<unknown>;
    });
    const value = await reply;
    this.#healthy();
    return value;
  }

  assertHealthy(): void {
    this.#healthy();
  }

  dispose(): void {
    this.#endpoint.removeEventListener('message', this.#onMessage);
    this.#endpoint.removeEventListener('messageerror', this.#onMessageError);
    this.#endpoint.removeEventListener('error', this.#onError);
  }
}

function markerSource(seed: string, marker: string, ordinal: number): string {
  const first = seed.replace('bench-seed', marker);
  const result = first.replace('bench-seed', `run-${ordinal}`);
  if (result === first || result.split(marker).length !== 2) {
    throw new Error('canonical Panel seed does not carry the expected marker slots');
  }
  return result;
}

function decodeRead(value: unknown, expectedPath: string): string {
  const reply = exactKind(value, 'read', ['path', 'text']);
  if (reply.path !== expectedPath) throw new TypeError('read reply path does not match request');
  return exactString(reply.text, `read reply ${expectedPath}`);
}

function installedVersion(manifest: string, dependency: string): string {
  let value: unknown;
  try {
    value = JSON.parse(manifest);
  } catch (error) {
    throw new Error(`installed ${dependency} manifest is not valid JSON`, { cause: error });
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`installed ${dependency} manifest must be an object`);
  }
  return exactString(Reflect.get(value, 'version'), `installed ${dependency} version`);
}

function decodeEntries(value: unknown, directory: string): readonly string[] {
  const reply = exactKind(value, 'entries', ['paths']);
  const paths = stringArray(reply.paths, 'entries reply paths');
  const unique = new Set(paths);
  if (unique.size !== paths.length) throw new TypeError('entries reply contains duplicate paths');
  const prefix = `${directory}/`;
  if (paths.some((path) => !path.startsWith(prefix) || path.slice(prefix.length).includes('/'))) {
    throw new TypeError('entries reply contains a path outside the requested directory');
  }
  return paths;
}

export async function runChildFsInRealmLane(ordinal: number, host: ChildFsInRealmLaneHost) {
  if (!Number.isInteger(ordinal) || ordinal <= 0) {
    throw new TypeError('child fs in-realm ordinal must be a positive integer');
  }
  const scenario = childFsScenario();
  const endpoint = host.open(workerUrl);
  const session = new SingleFlightWorkerSession(endpoint);
  try {
    await session.receive((value) => exactKind(value, 'ready'));
    await session.send({ kind: 'boot' }, (value) => {
      const reply = exactKind(value, 'booted', ['backend']);
      if (reply.backend !== 'memory') throw new TypeError('in-realm Worker backend must be memory');
      return reply;
    });
    const seededPaths = Object.keys(scenario.files)
      .map((path) => `${scenario.root}${path}`)
      .toSorted();
    await session.send({ kind: 'seed', files: scenario.files, root: scenario.root }, (value) => {
      const reply = exactKind(value, 'seeded', ['paths']);
      equalStrings(stringArray(reply.paths, 'seeded paths'), seededPaths, 'seeded paths');
      return reply;
    });
    await session.send(
      {
        kind: 'install',
        dependencies: scenario.dependencies,
        registryUrl: '/npm-registry',
        root: scenario.root,
      },
      (value) => exactKind(value, 'installed'),
    );
    for (const [dependency, expectedVersion] of Object.entries(scenario.dependencies)) {
      const path = `${scenario.root}/node_modules/${dependency}/package.json`;
      const manifest = await session.send({ kind: 'read', path }, (value) =>
        decodeRead(value, path),
      );
      const actualVersion = installedVersion(manifest, dependency);
      if (actualVersion !== expectedVersion) {
        throw new Error(`installed ${dependency} version does not match ${expectedVersion}`);
      }
    }

    const marker = `in-realm-${ordinal}`;
    const panelSeed = scenario.files['/src/Panel.jsx'];
    if (panelSeed === undefined) throw new TypeError('canonical Panel seed is missing');
    const path = `${scenario.root}/src/Panel.jsx`;
    await session.send(
      { kind: 'write', path, contents: markerSource(panelSeed, marker, ordinal) },
      (value) => {
        const reply = exactKind(value, 'written', ['path']);
        if (reply.path !== path) throw new TypeError('written reply path does not match request');
        return reply;
      },
    );

    const entryPath = `${scenario.root}/node_modules/.bin/vite`;
    const vite = await session.send(
      { kind: 'vite', args: ['build'], entryPath, root: scenario.root },
      (value) => {
        const reply = exactKind(value, 'vite', ['exitCode', 'rawOutput']);
        return {
          exitCode: exactZero(reply.exitCode, 'Vite reply exitCode'),
          rawOutput: exactString(reply.rawOutput, 'Vite reply rawOutput'),
        };
      },
    );
    const assetsDirectory = `${scenario.root}/dist/assets`;
    const entries = await session.send({ kind: 'readdir', path: assetsDirectory }, (value) =>
      decodeEntries(value, assetsDirectory),
    );
    const emittedPaths = entries.filter((entry) => entry.endsWith('.js'));
    if (emittedPaths.length === 0) throw new Error('in-realm Vite emitted no JavaScript assets');
    const emitted: string[] = [];
    for (const emittedPath of emittedPaths) {
      emitted.push(
        await session.send({ kind: 'read', path: emittedPath }, (value) =>
          decodeRead(value, emittedPath),
        ),
      );
    }
    const express = await session.send(
      {
        kind: 'express',
        entryPath: `${scenario.root}/express-anchor.cjs`,
        marker,
        root: scenario.root,
      },
      (value) => {
        const reply = exactKind(value, 'express', ['exitCode', 'rawOutput']);
        return {
          exitCode: exactZero(reply.exitCode, 'Express reply exitCode'),
          rawOutput: exactString(reply.rawOutput, 'Express reply rawOutput'),
        };
      },
    );
    await session.send({ kind: 'finish' }, (value) => exactKind(value, 'finished'));
    session.assertHealthy();
    const sample = {
      lane: 'in-realm' as const,
      topology: 'single-in-realm-worker' as const,
      ordinal,
      ownerLoad: 'idle' as const,
      vite: {
        exitCode: vite.exitCode,
        rawOutput: vite.rawOutput,
        emittedJavaScript: emitted.join('\n'),
        marker,
      },
      express: {
        exitCode: express.exitCode,
        rawOutput: express.rawOutput,
        marker,
      },
    };
    const parsed = validateChildFsRawSample(sample);
    if (parsed.vite.transformedModules !== 2180) {
      throw new Error(
        `in-realm child fs scenario transformed ${parsed.vite.transformedModules} modules, expected 2180`,
      );
    }
    return { identity: childFsScenarioIdentity(), sample };
  } finally {
    session.dispose();
    endpoint.terminate();
  }
}
