import { type FsSync, type PersistFailureReport, dirname, normalizePath } from '@riftydev/vfs';
import type {
  FsReadEncoding,
  FsRequest,
  FsResult,
  RuntimeEffects,
  SerializedRuntimeError,
} from './protocol.ts';

export type RuntimeFsFlush = () => Promise<PersistFailureReport | undefined> | Promise<void>;

export interface WorkerFsRpcDeps {
  readonly fs: FsSync;
  readonly invalidate: () => void;
  readonly flush?: RuntimeFsFlush;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function handleWorkerFsRequest(
  request: FsRequest,
  deps: WorkerFsRpcDeps,
): Promise<FsResult> {
  let effects: RuntimeEffects | undefined;
  try {
    let apply: (() => void) | undefined;
    switch (request.op) {
      case 'readFile': {
        assertUtf8Encoding(request.encoding);
        const bytes = new Uint8Array(
          deps.fs.readFileBytesSync(normalizeRuntimeFsPath(request.path)),
        );
        return {
          id: request.id,
          ok: true,
          value: request.encoding === undefined ? bytes : decoder.decode(bytes),
        };
      }
      case 'readdir':
        return {
          id: request.id,
          ok: true,
          value: deps.fs
            .readdirSync(normalizeRuntimeFsPath(request.path))
            .map((entry) => ({ ...entry })),
        };
      case 'stat':
        return {
          id: request.id,
          ok: true,
          value: { ...deps.fs.statSync(normalizeRuntimeFsPath(request.path)) },
        };
      case 'writeFile': {
        effects = { applied: 'no', persistence: 'unknown' };
        const path = normalizeRuntimeFsPath(request.path);
        if (typeof request.data !== 'string' && !(request.data instanceof Uint8Array)) {
          throw invalidArgument('fs.writeFile data must be string or Uint8Array');
        }
        const data =
          typeof request.data === 'string'
            ? encoder.encode(request.data)
            : new Uint8Array(request.data);
        apply = () => {
          deps.fs.mkdirSync(dirname(path), { recursive: true });
          deps.fs.writeFileSync(path, data);
        };
        break;
      }
      case 'mkdir': {
        effects = { applied: 'no', persistence: 'unknown' };
        const path = normalizeRuntimeFsPath(request.path);
        const options = mutationOptions(request.options, ['recursive']);
        apply = () => deps.fs.mkdirSync(path, options);
        break;
      }
      case 'rm': {
        effects = { applied: 'no', persistence: 'unknown' };
        const path = normalizeRuntimeFsPath(request.path);
        const options = mutationOptions(request.options, ['recursive', 'force']);
        apply = () => deps.fs.rmSync(path, options);
        break;
      }
      case 'rename': {
        effects = { applied: 'no', persistence: 'unknown' };
        const sourcePath = normalizeRuntimeFsPath(request.sourcePath);
        const targetPath = normalizeRuntimeFsPath(request.targetPath);
        apply = () => deps.fs.renameSync(sourcePath, targetPath);
        break;
      }
      case 'flush':
        break;
      default:
        throw invalidArgument(`Unknown fs op: ${(request as { op: string }).op}`);
    }
    if (apply !== undefined) {
      effects = { applied: 'unknown', persistence: 'unknown' };
      apply();
      effects = { applied: 'yes', persistence: 'unknown' };
      deps.invalidate();
    }
    effects = { applied: 'yes', persistence: 'failed' };
    const persistence = await checkedRuntimeFsFlush(deps.flush);
    return request.op === 'writeFile'
      ? { id: request.id, ok: true }
      : { id: request.id, ok: true, value: { applied: 'yes', persistence } };
  } catch (error) {
    return { id: request.id, ok: false, error: serializeRuntimeError(error, effects) };
  }
}

function invalidArgument(message: string): Error {
  return Object.assign(new TypeError(message), { code: 'ERR_INVALID_ARG_VALUE' });
}

function mutationOptions(
  options: unknown,
  allowed: readonly string[],
): { recursive?: boolean; force?: boolean } {
  if (options === undefined) return {};
  if (
    typeof options !== 'object' ||
    options === null ||
    (Object.getPrototypeOf(options) !== Object.prototype &&
      Object.getPrototypeOf(options) !== null) ||
    Object.getOwnPropertySymbols(options).length > 0
  ) {
    throw invalidArgument('fs options must be an object of boolean options');
  }
  const record = options as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key) || (record[key] !== undefined && typeof record[key] !== 'boolean')) {
      throw invalidArgument(`Invalid fs option: ${key}`);
    }
  }
  return {
    ...(typeof record.recursive === 'boolean' ? { recursive: record.recursive } : {}),
    ...(typeof record.force === 'boolean' ? { force: record.force } : {}),
  };
}

function assertUtf8Encoding(encoding: FsReadEncoding | undefined): void {
  if (encoding === undefined || encoding === 'utf8') return;
  if (encoding !== null && typeof encoding === 'object' && encoding.encoding === 'utf8') return;
  throw invalidArgument(`Unsupported fs encoding: ${JSON.stringify(encoding)}`);
}

/** Raw paths default to VFS root; project roots affect relative inputs only. */
export function normalizeRuntimeFsPath(path: string, root = '/'): string {
  if (typeof path !== 'string' || path.includes('\0')) throw invalidArgument('Invalid fs path');
  if (typeof root !== 'string' || !root.startsWith('/') || root.includes('\0')) {
    throw invalidArgument('Invalid fs root');
  }
  return normalizePath(path.startsWith('/') ? path : `${root}/${path}`);
}

/** OPFS flush reports failures instead of rejecting (ADR-0358). */
export async function checkedRuntimeFsFlush(flush?: RuntimeFsFlush): Promise<'memory' | 'flushed'> {
  const report = await flush?.();
  if (report === undefined) return 'memory';
  if (report.total === 0) return 'flushed';
  const detail = report.failures.map((failure) => `${failure.path}: ${failure.message}`).join('; ');
  const error = new Error(`OPFS persistence failed (${report.total} unhealed): ${detail}`);
  error.name = 'SandboxPersistenceError';
  throw error;
}

export function serializeRuntimeError(
  error: unknown,
  effects?: RuntimeEffects,
): SerializedRuntimeError {
  const failure = error instanceof Error ? error : new Error(String(error));
  const extra = failure as Error & {
    code?: unknown;
    path?: unknown;
    feature?: unknown;
    effects?: RuntimeEffects;
  };
  const applied = effects ?? extra.effects;
  return {
    name: failure.name,
    message: failure.message,
    ...(failure.stack === undefined ? {} : { stack: failure.stack }),
    ...(typeof extra.code === 'string' ? { code: extra.code } : {}),
    ...(typeof extra.path === 'string' ? { path: extra.path } : {}),
    ...(typeof extra.feature === 'string' ? { feature: extra.feature } : {}),
    ...(applied === undefined ? {} : { effects: applied }),
  };
}
