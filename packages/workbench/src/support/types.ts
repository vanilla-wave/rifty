export type SandboxSupportCheckId =
  | 'window'
  | 'secure-context'
  | 'cross-origin-isolated'
  | 'crypto'
  | 'page-locks'
  | 'module-worker'
  | 'module-import'
  | 'nested-worker'
  | 'message-port'
  | 'broadcast-channel'
  | 'js-eval'
  | 'wasm'
  | 'shared-memory'
  | 'opfs'
  | 'service-worker-api'
  | 'service-worker-registration'
  | 'service-worker-module-registration'
  | 'deployment-control'
  | 'cleanup';

export interface SandboxSupportCheck {
  readonly id: SandboxSupportCheckId;
  readonly status: 'passed' | 'failed' | 'incomplete' | 'not-applicable';
  readonly reason: string;
  readonly error?: { readonly name: string; readonly message: string };
}

export interface SandboxSupportMode {
  readonly composition: 'openWorkbench' | 'sdk-toolchain';
  readonly conclusion: 'supported' | 'unsupported' | 'inconclusive';
  readonly required: readonly SandboxSupportCheckId[];
  readonly unmet: readonly SandboxSupportCheckId[];
  readonly limitations: readonly SandboxSupportCheckId[];
}

export interface SandboxSupportOptions {
  /** Same-origin directory containing the four published support-*.js assets. */
  readonly probeBaseUrl: string | URL;
  /** Same policy as the existing owners; default preferred. */
  readonly persistence?: 'required' | 'preferred' | 'ephemeral';
  /** Existing SDK toolchain default is rewrite; COI always needs QuickJS WASM. */
  readonly nonCoiVmEngine?: 'rewrite' | 'quickjs';
  /** Require WASM for planned non-COI WASI/esbuild/SQLite workloads as well. */
  readonly wasm?: boolean;
  /** Per probe/cleanup phase, 1–60,000 ms; default 5,000. Suspended tabs can delay timers. */
  readonly timeoutMs?: number;
}

export interface SandboxSupportReport {
  readonly checkedAt: number;
  readonly checks: readonly SandboxSupportCheck[];
  readonly modes: { readonly coi: SandboxSupportMode; readonly nonCoi: SandboxSupportMode };
  readonly cleanup: SandboxSupportCheck;
  readonly limits: readonly string[];
}

/** Package-private protocol, isolated to one native Worker per invocation. */
export type SupportWorkerRequest =
  | {
      readonly kind: 'start';
      readonly name: string;
      readonly port: MessagePort;
      readonly memory?: SharedArrayBuffer;
    }
  | {
      readonly kind: 'storage';
      readonly directory: FileSystemDirectoryHandle;
      readonly name: string;
    };

export type SupportWorkerMessage =
  | { readonly kind: 'check'; readonly check: SandboxSupportCheck }
  | { readonly kind: 'done' };
