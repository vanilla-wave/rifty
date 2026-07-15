import { type WorkerEntryDescriptor, readKernelEntryBootstrap } from '@riftydev/kernel';
import type { NodeEntryTerminalBootstrap } from '@riftydev/runtime-js/builtins/node-entry-url';
import { isAbsolute, normalizePath } from '@riftydev/vfs';
import type { NodeServerPackageConfig } from '../workbench/internal/project-package-config.ts';
import {
  type NodeWorkerRuntimeConfig,
  snapshotNodeWorkerRuntimeConfig,
} from './node-worker-runtime-config.ts';

export const DEV_SERVER_CHILD_BOOTSTRAP_PROTOCOL = 'rifty.dev-server/v1' as const;

export interface DevServerChildConfig {
  readonly nodeWorkerRuntime: NodeWorkerRuntimeConfig;
  readonly cfg: NodeServerPackageConfig;
  readonly terminal: NodeEntryTerminalBootstrap;
  readonly previewScope?: string;
}

function record(value: unknown, owner: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${owner} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exact(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  owner: string,
): void {
  const allowed = new Set([...required, ...optional]);
  const actual = Reflect.ownKeys(value);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    actual.some((key) => typeof key !== 'string' || !allowed.has(key))
  ) {
    throw new TypeError(`${owner} has missing or unexpected fields`);
  }
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function projectRoot(value: unknown): string {
  const root = nonEmptyString(value, 'dev-server bootstrap cfg.root');
  if (!isAbsolute(root) || root === '/' || normalizePath(root) !== root) {
    throw new TypeError(
      'dev-server bootstrap cfg.root must be an absolute normalized project root',
    );
  }
  return root;
}

function projectPath(value: unknown, root: string, field: string): string {
  const path = nonEmptyString(value, field);
  if (!isAbsolute(path) || normalizePath(path) !== path || !path.startsWith(`${root}/`)) {
    throw new TypeError(`${field} must be a normalized path inside cfg.root`);
  }
  return path;
}

function serverPort(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 65_535) {
    throw new RangeError('dev-server bootstrap cfg.port must be an integer from 1 to 65535');
  }
  return value as number;
}

function stringMap(value: unknown, field: string): Readonly<Record<string, string>> {
  const source = record(value, field);
  const snapshot: Record<string, string> = {};
  for (const key of Reflect.ownKeys(source)) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError(`${field} keys must be non-empty strings`);
    }
    const entry = source[key];
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new TypeError(`${field}.${key} must be a non-empty string`);
    }
    Object.defineProperty(snapshot, key, {
      value: entry,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(snapshot);
}

function seedFiles(value: unknown, root: string): Readonly<Record<string, string>> {
  const source = record(value, 'dev-server bootstrap cfg.seedFiles');
  const snapshot: Record<string, string> = {};
  for (const key of Reflect.ownKeys(source)) {
    if (typeof key !== 'string') {
      throw new TypeError('dev-server bootstrap cfg.seedFiles keys must be strings');
    }
    const path = projectPath(key, root, 'dev-server bootstrap cfg.seedFiles path');
    const content = source[key];
    if (typeof content !== 'string') {
      throw new TypeError(`dev-server bootstrap cfg.seedFiles.${path} must be a string`);
    }
    Object.defineProperty(snapshot, path, {
      value: content,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(snapshot);
}

function packageJson(value: unknown): string {
  const text = nonEmptyString(value, 'dev-server bootstrap cfg.packageJson');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new TypeError(
      `dev-server bootstrap cfg.packageJson must be valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('dev-server bootstrap cfg.packageJson must contain an object');
  }
  return text;
}

function optionalString(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : nonEmptyString(value, field);
}

function optionalOwnField(value: Record<string, unknown>, field: string): unknown {
  return Object.prototype.hasOwnProperty.call(value, field) ? value[field] : undefined;
}

function booleanField(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${field} must be a boolean`);
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new RangeError(`${field} must be a positive safe integer`);
  }
  return value as number;
}

function snapshotTerminal(value: unknown): NodeEntryTerminalBootstrap {
  const terminal = record(value, 'dev-server bootstrap terminal');
  exact(
    terminal,
    ['stdinIsTTY', 'stdoutIsTTY', 'stderrIsTTY', 'cols', 'rows'],
    [],
    'dev-server bootstrap terminal',
  );
  return Object.freeze({
    stdinIsTTY: booleanField(terminal.stdinIsTTY, 'dev-server bootstrap terminal.stdinIsTTY'),
    stdoutIsTTY: booleanField(terminal.stdoutIsTTY, 'dev-server bootstrap terminal.stdoutIsTTY'),
    stderrIsTTY: booleanField(terminal.stderrIsTTY, 'dev-server bootstrap terminal.stderrIsTTY'),
    cols: positiveInteger(terminal.cols, 'dev-server bootstrap terminal.cols'),
    rows: positiveInteger(terminal.rows, 'dev-server bootstrap terminal.rows'),
  });
}

function snapshotPackageConfig(value: unknown): NodeServerPackageConfig {
  const cfg = record(value, 'dev-server bootstrap cfg');
  exact(
    cfg,
    [
      'runtime',
      'root',
      'port',
      'entryPath',
      'packageName',
      'packageVersion',
      'installDeps',
      'packageJson',
      'seedFiles',
    ],
    ['bakedNodeModulesUrl', 'bakedNodeModulesTemplateId'],
    'dev-server bootstrap cfg',
  );
  if (cfg.runtime !== 'node-server') {
    throw new TypeError('dev-server bootstrap cfg.runtime must be node-server');
  }
  const root = projectRoot(cfg.root);
  const bakedNodeModulesUrl = optionalString(
    optionalOwnField(cfg, 'bakedNodeModulesUrl'),
    'dev-server bootstrap cfg.bakedNodeModulesUrl',
  );
  const bakedNodeModulesTemplateId = optionalString(
    optionalOwnField(cfg, 'bakedNodeModulesTemplateId'),
    'dev-server bootstrap cfg.bakedNodeModulesTemplateId',
  );
  return Object.freeze({
    runtime: 'node-server',
    root,
    port: serverPort(cfg.port),
    entryPath: projectPath(cfg.entryPath, root, 'dev-server bootstrap cfg.entryPath'),
    packageName: nonEmptyString(cfg.packageName, 'dev-server bootstrap cfg.packageName'),
    packageVersion: nonEmptyString(cfg.packageVersion, 'dev-server bootstrap cfg.packageVersion'),
    installDeps: stringMap(cfg.installDeps, 'dev-server bootstrap cfg.installDeps'),
    packageJson: packageJson(cfg.packageJson),
    seedFiles: seedFiles(cfg.seedFiles, root),
    ...(bakedNodeModulesUrl === undefined ? {} : { bakedNodeModulesUrl }),
    ...(bakedNodeModulesTemplateId === undefined ? {} : { bakedNodeModulesTemplateId }),
  });
}

function inspectBootstrap(value: unknown): DevServerChildConfig {
  if (value === null) throw new Error('dev-server-child: missing entry bootstrap envelope');
  const envelope = record(value, 'dev-server bootstrap envelope');
  exact(envelope, ['protocol', 'payload'], [], 'dev-server bootstrap envelope');
  if (envelope.protocol !== DEV_SERVER_CHILD_BOOTSTRAP_PROTOCOL) {
    throw new Error(
      `dev-server-child: bootstrap protocol mismatch: expected ${DEV_SERVER_CHILD_BOOTSTRAP_PROTOCOL}, received ${String(envelope.protocol)}`,
    );
  }
  const payload = record(envelope.payload, 'dev-server bootstrap payload');
  exact(
    payload,
    ['nodeWorkerRuntime', 'cfg', 'terminal'],
    ['previewScope'],
    'dev-server bootstrap payload',
  );
  const cfg = snapshotPackageConfig(payload.cfg);
  const terminal = snapshotTerminal(payload.terminal);
  const previewScope = optionalString(
    optionalOwnField(payload, 'previewScope'),
    'dev-server bootstrap payload.previewScope',
  );
  return Object.freeze({
    nodeWorkerRuntime: snapshotNodeWorkerRuntimeConfig(
      payload.nodeWorkerRuntime,
      'dev-server bootstrap nodeWorkerRuntime',
    ),
    cfg,
    terminal,
    ...(previewScope === undefined ? {} : { previewScope }),
  });
}

/** Build one complete entry-scoped config; the child never re-resolves app policy. */
export function buildDevServerChildEntry(
  url: string,
  input: {
    readonly nodeWorkerRuntime: NodeWorkerRuntimeConfig;
    readonly cfg: NodeServerPackageConfig;
    readonly terminal: NodeEntryTerminalBootstrap;
    readonly previewScope?: string;
  },
): Extract<WorkerEntryDescriptor, { readonly kind: 'url' }> {
  if (typeof url !== 'string' || url.length === 0) {
    throw new TypeError('dev-server worker URL must be a non-empty string');
  }
  const inspected = inspectBootstrap({
    protocol: DEV_SERVER_CHILD_BOOTSTRAP_PROTOCOL,
    payload: input,
  });
  return Object.freeze({
    kind: 'url',
    url,
    bootstrap: Object.freeze({
      protocol: DEV_SERVER_CHILD_BOOTSTRAP_PROTOCOL,
      payload: Object.freeze({
        nodeWorkerRuntime: inspected.nodeWorkerRuntime,
        cfg: inspected.cfg,
        terminal: inspected.terminal,
        ...(inspected.previewScope === undefined ? {} : { previewScope: inspected.previewScope }),
      }),
    }),
  });
}

/** Pure decoder shared by the producer builder and fault tests. */
export function resolveDevServerChildConfig(bootstrap: unknown): DevServerChildConfig {
  return inspectBootstrap(bootstrap);
}

/** Read the exact URL-entry envelope; no env/template-registry fallback. */
export function readDevServerChildConfig(): DevServerChildConfig {
  return inspectBootstrap(readKernelEntryBootstrap());
}
