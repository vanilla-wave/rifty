interface NodeEntryWorkerConfig {
  readonly url: string;
  readonly runtimeEnv: Readonly<Record<string, string>> | null;
}

let nodeEntryWorkerConfig: NodeEntryWorkerConfig | null = null;

function snapshotUrl(url: string | URL): string {
  const value = String(url);
  if (value.length === 0) throw new TypeError('node-entry worker URL must be non-empty');
  return value;
}

function snapshotRuntimeEnv(
  env: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const entries = Object.entries(env);
  if (entries.length === 0) {
    throw new TypeError('node-entry worker runtime env must contain reserved RIFTY_* values');
  }
  const snapshot: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!key.startsWith('RIFTY_') || typeof value !== 'string' || value.length === 0) {
      throw new TypeError(
        'node-entry worker runtime env must map reserved RIFTY_* keys to non-empty strings',
      );
    }
    snapshot[key] = value;
  }
  return Object.freeze(snapshot);
}

/** Atomically install the node-entry URL and its host-owned bootstrap snapshot. */
export function configureNodeEntryWorkerRuntime(
  url: string | URL,
  runtimeEnv: Readonly<Record<string, string>>,
): void {
  const nextUrl = snapshotUrl(url);
  const nextRuntimeEnv = snapshotRuntimeEnv(runtimeEnv);
  nodeEntryWorkerConfig = { url: nextUrl, runtimeEnv: nextRuntimeEnv };
}

/** URL-only compatibility seam: a previous bootstrap snapshot is invalid now. */
export function setNodeEntryWorkerUrlOnly(url: string | URL): void {
  nodeEntryWorkerConfig = { url: snapshotUrl(url), runtimeEnv: null };
}

export function getConfiguredNodeEntryWorkerUrl(): string | null {
  return nodeEntryWorkerConfig?.url ?? null;
}

export function mergeNodeEntryWorkerEnv(
  userEnv: Readonly<Record<string, string>>,
  runtimeEnv?: Readonly<Record<string, string>>,
): Record<string, string> {
  const hostEnv =
    runtimeEnv === undefined ? nodeEntryWorkerConfig?.runtimeEnv : snapshotRuntimeEnv(runtimeEnv);
  if (hostEnv == null) {
    throw new Error('node-entry worker runtime config is not configured');
  }
  return { ...userEnv, ...hostEnv };
}

export function resetNodeEntryWorkerRuntime(): void {
  nodeEntryWorkerConfig = null;
}
