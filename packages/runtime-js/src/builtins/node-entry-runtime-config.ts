let nodeEntryWorkerRuntimeEnv: Readonly<Record<string, string>> = {};

export function setNodeEntryWorkerRuntimeEnv(env: Readonly<Record<string, string>>): void {
  const snapshot: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.length === 0 || typeof value !== 'string' || value.length === 0) {
      throw new TypeError('node-entry worker runtime env must map non-empty keys to strings');
    }
    snapshot[key] = value;
  }
  nodeEntryWorkerRuntimeEnv = snapshot;
}

export function mergeNodeEntryWorkerEnv(
  userEnv: Readonly<Record<string, string>>,
  runtimeEnv: Readonly<Record<string, string>> = nodeEntryWorkerRuntimeEnv,
): Record<string, string> {
  return { ...userEnv, ...runtimeEnv };
}

export function resetNodeEntryWorkerRuntimeEnv(): void {
  nodeEntryWorkerRuntimeEnv = {};
}
