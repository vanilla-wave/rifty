import {
  readActiveNodeProcessBootstrap,
  readNodeProcessBootstrapIdentity,
} from './process-bootstrap-identity.ts';
import { NodeProcess } from './process.ts';

export interface NodeProcessContextSnapshot {
  readonly pid: number;
  readonly ppid: number;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

interface ProcessContextShape {
  readonly pid?: unknown;
  readonly ppid?: unknown;
  readonly env?: unknown;
  readonly cwd?: unknown;
}

/** Snapshot ProcessEnv keys; Node omits own entries whose value is undefined. */
export function snapshotProcessEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) snapshot[key] = value;
  }
  return snapshot;
}

/** Construction-time snapshot, or null outside a kernel-installed Node realm. */
export function snapshotNodeProcessContext(): NodeProcessContextSnapshot | null {
  const active = readActiveNodeProcessBootstrap();
  const candidate = active?.process ?? (globalThis as { process?: unknown }).process;
  if (typeof candidate !== 'object' || candidate === null) return null;
  const process = candidate as ProcessContextShape;
  const trustedSynthetic = active?.identity !== null && active?.identity !== undefined;
  if (!(candidate instanceof NodeProcess) && !trustedSynthetic) return null;
  if (
    typeof process.cwd !== 'function' ||
    typeof process.env !== 'object' ||
    process.env === null
  ) {
    return null;
  }
  const identity = active?.identity ?? readNodeProcessBootstrapIdentity(candidate);
  const pid = identity?.pid ?? process.pid;
  const ppid = identity?.ppid ?? process.ppid;
  const cwd = Reflect.apply(process.cwd, candidate, []) as unknown;
  if (typeof pid !== 'number' || typeof ppid !== 'number' || typeof cwd !== 'string') return null;
  return {
    pid,
    ppid,
    cwd,
    env: snapshotProcessEnv(process.env as Readonly<Record<string, string | undefined>>),
  };
}

/** Invariant seam for operations that cannot exist without a calling process. */
export function requireNodeProcessContext(operation: string): NodeProcessContextSnapshot {
  const context = snapshotNodeProcessContext();
  if (context === null) {
    throw new Error(`${operation}: kernel Node process context is unavailable`);
  }
  return context;
}
