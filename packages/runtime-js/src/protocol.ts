/**
 * Message protocol between the host (main thread) and a runtime Worker.
 *
 * Versioned by string discriminator; never changed in place — when the shape
 * grows incompatibly, add a new `type` rather than mutating an existing one.
 */

import type { FsSync, VfsDirent } from '@riftydev/vfs';
import type { TelemetryEntry } from './telemetry/divergence-sink.ts';

/** Aggregated divergence / NotImplemented telemetry, posted over the worker
 * boundary as the `diagnostic` message payload (T15). */
export type TelemetrySnapshot = readonly TelemetryEntry[];

export interface EvalRequest {
  readonly id: number;
  readonly code: string;
  /** Optional VFS root path the eval treats as the current working directory. */
  readonly cwd?: string;
}

export type EvalResult =
  | { readonly id: number; readonly ok: true; readonly value: undefined }
  | {
      readonly id: number;
      readonly ok: false;
      readonly error: { readonly name: string; readonly message: string; readonly stack?: string };
    };

export type FsReadEncoding = 'utf8' | { readonly encoding: 'utf8' };

export interface RuntimeEffects {
  readonly applied: 'no' | 'yes' | 'unknown';
  readonly persistence: 'memory' | 'flushed' | 'failed' | 'unknown';
}

export type RuntimeFsStat = ReturnType<FsSync['statSync']>;
export type RuntimeFsDirent = VfsDirent;

export type FsOperation =
  | {
      readonly op: 'readFile';
      readonly path: string;
      readonly encoding?: FsReadEncoding;
    }
  | {
      readonly op: 'writeFile';
      readonly path: string;
      readonly data: string | Uint8Array;
    }
  | { readonly op: 'readdir' | 'stat'; readonly path: string }
  | {
      readonly op: 'mkdir';
      readonly path: string;
      readonly options?: { readonly recursive?: boolean };
    }
  | {
      readonly op: 'rm';
      readonly path: string;
      readonly options?: { readonly recursive?: boolean; readonly force?: boolean };
    }
  | { readonly op: 'rename'; readonly sourcePath: string; readonly targetPath: string }
  | { readonly op: 'flush' };

export type FsRequest = FsOperation & { readonly id: number };

export interface SerializedRuntimeError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly code?: string;
  readonly path?: string;
  readonly feature?: string;
  readonly effects?: RuntimeEffects;
}

export type FsResult =
  | {
      readonly id: number;
      readonly ok: true;
      readonly value?:
        | string
        | Uint8Array
        | RuntimeFsStat
        | readonly RuntimeFsDirent[]
        | RuntimeEffects;
    }
  | { readonly id: number; readonly ok: false; readonly error: SerializedRuntimeError };

export interface ToolchainInstallRequest {
  readonly cwd: string;
  readonly registryUrl: string;
}

export interface ToolchainRunBinRequest {
  readonly cwd: string;
  readonly binPath: string;
  readonly args: readonly string[];
}

export interface ToolchainStartBinRequest extends ToolchainRunBinRequest {
  readonly port: number;
}

export interface ToolchainRuntimeBinding {
  readonly adapterId: string;
  readonly packagePath: string;
}

export interface ToolchainRecoveryFile {
  readonly path: string;
  readonly data: Uint8Array;
}

export interface ToolchainActivationState {
  readonly cwd: string;
  readonly bindings: readonly ToolchainRuntimeBinding[];
  readonly vfsBackend: 'opfs' | 'memory';
  readonly files: readonly ToolchainRecoveryFile[];
  /** Additive recovery metadata; legacy snapshots derive parents from files. */
  readonly directories?: readonly string[];
}

export interface ToolchainProjectOptions {
  readonly root: string;
  readonly readonlyPaths?: readonly string[];
  readonly allowedCommands?: readonly string[];
}

export interface ToolchainCommandInput {
  readonly project: ToolchainProjectOptions;
  readonly command: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

export interface ToolchainCommandResult {
  readonly status: 'exited' | 'cancelled' | 'failed';
  readonly exitCode: number | null;
  readonly effects: RuntimeEffects;
  readonly error?: SerializedRuntimeError;
  /** Host must terminate this realm before exposing completion or permitting reuse. */
  readonly requiresTermination?: boolean;
}

export type ToolchainRequest =
  | { readonly id: number; readonly op: 'install'; readonly input: ToolchainInstallRequest }
  | { readonly id: number; readonly op: 'open'; readonly input: ToolchainInstallRequest }
  | { readonly id: number; readonly op: 'run-bin'; readonly input: ToolchainRunBinRequest }
  | { readonly id: number; readonly op: 'start-bin'; readonly input: ToolchainStartBinRequest }
  | { readonly id: number; readonly op: 'restore'; readonly input: ToolchainActivationState }
  | {
      readonly id: number;
      readonly op: 'project-fs';
      readonly input: { readonly project: ToolchainProjectOptions; readonly request: FsRequest };
    }
  | { readonly id: number; readonly op: 'command'; readonly input: ToolchainCommandInput };

export type ToolchainResultValue =
  | { readonly exitCode: number }
  | { readonly port: number }
  | { readonly activationState: ToolchainActivationState }
  | { readonly fsResult: FsResult }
  | {
      readonly command: ToolchainCommandResult;
      readonly activationState?: ToolchainActivationState;
    };

export type ToolchainResult =
  | {
      readonly id: number;
      readonly ok: true;
      readonly value?: ToolchainResultValue;
    }
  | { readonly id: number; readonly ok: false; readonly error: SerializedRuntimeError };

export const SANDBOX_TOOLCHAIN_PROTOCOL = 'rifty.sandbox-toolchain/v4' as const;

/** `node:vm` sandbox engine (ADR-0142): the real-realm QuickJS engine (default
 * after the T17 cutover) or the opt-in hardened-rewrite engine. */
export type VmEngineName = 'quickjs' | 'rewrite';

export type HostMessage =
  | { readonly type: 'eval'; readonly request: EvalRequest }
  | { readonly type: 'fs'; readonly request: FsRequest }
  | { readonly type: 'ping' }
  | { readonly type: 'load-fixture'; readonly files: Readonly<Record<string, string>> }
  | { readonly type: 'stdin'; readonly data: string | Uint8Array }
  /** Programmatic `node:vm` engine override (ADR-0142). The worker applies it via
   * `setVmEngineOverride`, taking precedence over the `__RIFTY_VM_ENGINE` env. */
  | { readonly type: 'vm-config'; readonly engine: VmEngineName };

export type WorkerMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'stdout'; readonly chunk: string }
  | { readonly type: 'stderr'; readonly chunk: string }
  | { readonly type: 'result'; readonly result: EvalResult }
  | { readonly type: 'fs-result'; readonly result: FsResult }
  | { readonly type: 'pong' }
  /** Divergence / NotImplemented telemetry snapshot (T15). Posted by the worker
   * when the snapshot changes; surfaced host-side for the playground panel (T16). */
  | { readonly type: 'diagnostic'; readonly payload: TelemetrySnapshot };

export type ToolchainHostMessage =
  | HostMessage
  | { readonly type: 'toolchain'; readonly request: ToolchainRequest }
  | { readonly type: 'toolchain-command-stop'; readonly id: number };

export type ToolchainWorkerMessage =
  | WorkerMessage
  | {
      readonly type: 'toolchain-ready';
      readonly protocol: typeof SANDBOX_TOOLCHAIN_PROTOCOL;
      readonly vfsBackend: 'opfs' | 'memory';
    }
  | { readonly type: 'toolchain-terminal'; readonly reason: 'closed' }
  | { readonly type: 'toolchain-command-started'; readonly id: number }
  | {
      readonly type: 'toolchain-command-output';
      readonly id: number;
      readonly stream: 'stdout' | 'stderr';
      readonly chunk: string;
    }
  | { readonly type: 'toolchain-result'; readonly result: ToolchainResult };
