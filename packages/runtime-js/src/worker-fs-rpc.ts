import { dirname, normalizePath } from '@riftydev/vfs';
import type { FsSync } from '@riftydev/vfs';
import type { FsReadEncoding, FsRequest, FsResult, SerializedRuntimeError } from './protocol.ts';

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
      assertUtf8Encoding(request.encoding);
      const path = normalizeAbsolute(request.path);
      const bytes = new Uint8Array(deps.fs.readFileBytesSync(path));
      if (request.encoding === undefined) return { id: request.id, ok: true, value: bytes };
      return { id: request.id, ok: true, value: decoder.decode(bytes) };
    }
    if (request.op !== 'writeFile') {
      // Untrusted wire input: an unknown op must not fall through to a write.
      throw Object.assign(new Error(`Unknown fs op: ${(request as { op: string }).op}`), {
        code: 'ERR_INVALID_ARG_VALUE',
      });
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

// Only utf8 is wired end-to-end; anything else must fail loudly, not silently
// decode as utf8 (no-silent-stubs).
function assertUtf8Encoding(encoding: FsReadEncoding | undefined): void {
  if (encoding === undefined || encoding === 'utf8') return;
  if (typeof encoding === 'object' && encoding.encoding === 'utf8') return;
  throw Object.assign(new Error(`Unsupported fs encoding: ${JSON.stringify(encoding)}`), {
    code: 'ERR_INVALID_ARG_VALUE',
  });
}

/**
 * Host fs paths anchor at the VFS ROOT, not the guest cwd (`/workspace`) —
 * the worker cwd is mutable across evals, so root-anchoring keeps the host
 * control plane deterministic. Documented on `RuntimeFs` (host.ts).
 */
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
