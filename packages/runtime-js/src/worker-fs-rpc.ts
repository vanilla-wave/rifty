import { dirname, normalizePath } from '@riftydev/vfs';
import type { FsSync } from '@riftydev/vfs';
import type { FsRequest, FsResult, SerializedRuntimeError } from './protocol.ts';

export interface WorkerFsRpcDeps {
  readonly fs: FsSync;
  readonly invalidate: () => void;
  readonly flush?: () => Promise<void>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function handleWorkerFsRequest(
  request: FsRequest,
  deps: WorkerFsRpcDeps,
): Promise<FsResult> {
  try {
    if (request.op === 'readFile') {
      const path = normalizeAbsolute(request.path);
      const bytes = new Uint8Array(deps.fs.readFileBytesSync(path));
      if (request.encoding === undefined) return { id: request.id, ok: true, value: bytes };
      return { id: request.id, ok: true, value: decoder.decode(bytes) };
    }

    const path = normalizeAbsolute(request.path);
    deps.fs.mkdirSync(dirname(path), { recursive: true });
    deps.fs.writeFileSync(
      path,
      typeof request.data === 'string'
        ? encoder.encode(request.data)
        : new Uint8Array(request.data),
    );
    deps.invalidate();
    if (deps.flush) await deps.flush();
    return { id: request.id, ok: true };
  } catch (err) {
    return { id: request.id, ok: false, error: serializeError(err) };
  }
}

function normalizeAbsolute(path: string): string {
  const normalized = normalizePath(path);
  if (normalized.startsWith('/')) return normalized;
  if (normalized === '.') return '/';
  return `/${normalized}`;
}

function serializeError(err: unknown): SerializedRuntimeError {
  if (err instanceof Error) {
    const extra = err as Error & { code?: unknown; path?: unknown };
    return {
      name: err.name,
      message: err.message,
      ...(err.stack === undefined ? {} : { stack: err.stack }),
      ...(typeof extra.code === 'string' ? { code: extra.code } : {}),
      ...(typeof extra.path === 'string' ? { path: extra.path } : {}),
    };
  }
  return { name: 'Error', message: String(err) };
}
