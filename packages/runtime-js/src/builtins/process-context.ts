import { NodeProcess } from './process.ts';

export interface NodeProcessContextSnapshot {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
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
  const process = (globalThis as { process?: unknown }).process;
  if (!(process instanceof NodeProcess)) return null;
  return {
    cwd: process.cwd(),
    env: snapshotProcessEnv(process.env),
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
