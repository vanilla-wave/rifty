export interface Capabilities {
  readonly crossOriginIsolated: boolean;
  readonly sharedArrayBuffer: boolean;
  readonly atomicsWaitAsync: boolean;
  readonly opfsSyncAccessHandle: boolean;
  readonly serviceWorker: boolean;
  readonly worker: boolean;
}

export interface CapabilityCheck {
  readonly capabilities: Capabilities;
  readonly missing: readonly (keyof Capabilities)[];
  /** True iff everything required for M0–M2 is present. */
  readonly sufficient: boolean;
  /** Human-readable summary suitable for surfacing in the UI. */
  readonly summary: string;
}

const REQUIRED_FOR_M2: readonly (keyof Capabilities)[] = ['worker', 'serviceWorker'];

export function detectCapabilities(): CapabilityCheck {
  const g = globalThis as unknown as Record<string, unknown>;
  const navigatorAny = (g.navigator ?? {}) as Record<string, unknown>;

  const capabilities: Capabilities = {
    crossOriginIsolated: Boolean(g.crossOriginIsolated),
    sharedArrayBuffer: typeof g.SharedArrayBuffer === 'function',
    atomicsWaitAsync:
      typeof g.Atomics === 'object' &&
      g.Atomics !== null &&
      typeof (g.Atomics as { waitAsync?: unknown }).waitAsync === 'function',
    opfsSyncAccessHandle: detectOpfsSyncAccessHandle(),
    serviceWorker: typeof navigatorAny.serviceWorker !== 'undefined',
    worker: typeof g.Worker === 'function',
  };

  const missing = (Object.keys(capabilities) as (keyof Capabilities)[]).filter(
    (k) => !capabilities[k],
  );
  const sufficient = REQUIRED_FOR_M2.every((k) => capabilities[k]);

  const lines: string[] = [];
  for (const k of Object.keys(capabilities) as (keyof Capabilities)[]) {
    lines.push(`  ${capabilities[k] ? '✓' : '✗'} ${k}`);
  }
  const summary = `Capabilities:\n${lines.join('\n')}`;

  return { capabilities, missing, sufficient, summary };
}

function detectOpfsSyncAccessHandle(): boolean {
  const g = globalThis as unknown as Record<string, unknown>;
  if (
    typeof g.FileSystemFileHandle === 'undefined' ||
    typeof (g.FileSystemFileHandle as { prototype?: unknown }).prototype !== 'object'
  ) {
    return false;
  }
  const proto = (g.FileSystemFileHandle as { prototype: object }).prototype;
  return (
    typeof (proto as { createSyncAccessHandle?: unknown }).createSyncAccessHandle === 'function'
  );
}
