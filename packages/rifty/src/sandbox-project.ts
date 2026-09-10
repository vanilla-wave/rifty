import type { RuntimeEffects, RuntimeFs, SerializedRuntimeError } from '@riftydev/runtime-js';
import {
  type RuntimeCommandCall,
  type ToolchainProjectOptions,
  type ToolchainRuntimeController,
  validateProjectOptions,
} from '@riftydev/runtime-js/internal';
import { delegateSandboxFs } from './sandbox-fs.ts';

export type SandboxProjectOptions = ToolchainProjectOptions;

export interface SandboxCommandOptions {
  /** Relative to project.root; defaults to project.root for every invocation. */
  readonly cwd?: string;
  /** A fresh environment for this call; no preceding invocation state. */
  readonly env?: Readonly<Record<string, string>>;
}

export interface SandboxCommandOutput {
  readonly stream: 'stdout' | 'stderr';
  readonly chunk: string;
}

export interface SandboxCommandOutcome {
  readonly status: 'exited' | 'cancelled' | 'failed';
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly effects: RuntimeEffects;
  readonly worker: 'retained' | 'replaced' | 'terminated';
  readonly error?: SerializedRuntimeError;
}

export interface SandboxCommandRun {
  readonly completion: Promise<SandboxCommandOutcome>;
  /** Signal cancellation; after 1s without settlement, replace the admitted Worker's realm.
   * Resolves with completion only after real settlement or physical termination.
   * Forced replacement reports unknown effects and never replays the command. */
  stop(): Promise<SandboxCommandOutcome>;
  /** Subscribe immediately after run(); no replay. Completion includes captured output. */
  onOutput(listener: (output: SandboxCommandOutput) => void): () => void;
}

export interface SandboxProject {
  /** Relative paths anchor at root; absolute paths keep their VFS meaning. */
  readonly fs: RuntimeFs;
  /** Fresh Shell cwd/env per call; files persist. Background jobs are rejected. */
  run(command: string, options?: SandboxCommandOptions): SandboxCommandRun;
}

interface ProjectOwner {
  current(): ToolchainRuntimeController;
  mutate<T>(operation: () => Promise<T>): Promise<T>;
  replace(target: ToolchainRuntimeController): Promise<'replaced' | 'terminated'>;
}

function serialized(error: unknown): SerializedRuntimeError {
  const inspected = error instanceof Error ? error : new Error(String(error));
  const detail = inspected as Error & { code?: string; path?: string; effects?: RuntimeEffects };
  return {
    name: inspected.name,
    message: inspected.message,
    ...(detail.code === undefined ? {} : { code: detail.code }),
    ...(detail.path === undefined ? {} : { path: detail.path }),
    ...(detail.effects === undefined ? {} : { effects: detail.effects }),
  };
}

const unknownEffects: RuntimeEffects = Object.freeze({
  applied: 'unknown',
  persistence: 'unknown',
});

export function createSandboxProject(
  input: SandboxProjectOptions,
  owner: ProjectOwner,
): SandboxProject {
  const project = validateProjectOptions(input);
  const fs = delegateSandboxFs(
    () => owner.current().projectFs(project),
    (operation) => owner.mutate(operation),
  );
  return Object.freeze({
    fs,
    run(command: string, options: SandboxCommandOptions = {}): SandboxCommandRun {
      if (
        options === null ||
        typeof options !== 'object' ||
        Array.isArray(options) ||
        Object.keys(options).some((key) => key !== 'cwd' && key !== 'env')
      )
        throw new TypeError('command options must contain only cwd/env');
      const target = owner.current();
      const listeners = new Set<(output: SandboxCommandOutput) => void>();
      let stdout = '';
      let stderr = '';
      let admitted = false;
      let stopped = false;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let replacement: Promise<'replaced' | 'terminated'> | undefined;
      const replace = () => {
        replacement ??= Promise.resolve()
          .then(() => owner.replace(target))
          .catch(() => 'terminated' as const);
        return replacement;
      };
      const arm = () => {
        if (admitted && stopped && !settled && timer === undefined)
          timer = setTimeout(() => {
            void replace();
          }, 1000);
      };
      let call: RuntimeCommandCall;
      try {
        call = target.command(
          { project, command, cwd: options.cwd ?? project.root, env: options.env ?? {} },
          {
            started() {
              admitted = true;
              arm();
            },
            output(chunk, stream) {
              if (settled) return;
              if (stream === 'stdout') stdout += chunk;
              else stderr += chunk;
              for (const listener of listeners) {
                try {
                  listener({ stream, chunk });
                } catch (error) {
                  console.error('command output listener threw', error);
                }
              }
            },
          },
        );
      } catch (error) {
        call = { result: Promise.reject(error), stop() {} };
      }
      const completion: Promise<SandboxCommandOutcome> = call.result
        .then(
          async (result): Promise<SandboxCommandOutcome> => {
            if (!result.requiresTermination) settled = true;
            if (timer !== undefined) clearTimeout(timer);
            const worker =
              result.requiresTermination || replacement !== undefined
                ? await replace()
                : 'retained';
            settled = true;
            return {
              status: result.status === 'failed' ? 'failed' : stopped ? 'cancelled' : result.status,
              exitCode: result.exitCode,
              stdout,
              stderr,
              effects: worker === 'retained' ? result.effects : unknownEffects,
              worker,
              ...(result.error === undefined ? {} : { error: result.error }),
            };
          },
          async (error: unknown): Promise<SandboxCommandOutcome> => {
            settled = true;
            if (timer !== undefined) clearTimeout(timer);
            const inspected = serialized(error);
            const peerLost =
              inspected.name === 'WorkerTerminated' ||
              inspected.code === 'WORKER_CRASHED' ||
              inspected.code === 'RUNTIME_NOT_RUNNING';
            const worker = peerLost || replacement !== undefined ? await replace() : 'retained';
            return {
              status: stopped ? 'cancelled' : 'failed',
              exitCode: null,
              stdout,
              stderr,
              effects:
                peerLost || replacement !== undefined
                  ? unknownEffects
                  : (inspected.effects ?? { applied: 'no', persistence: 'unknown' }),
              worker,
              error: inspected,
            };
          },
        )
        .finally(() => listeners.clear());
      return Object.freeze({
        completion,
        stop() {
          if (!settled && !stopped) {
            stopped = true;
            try {
              call.stop();
            } catch {
              /* Peer rejection settles through completion. */
            }
            arm();
          }
          return completion;
        },
        onOutput(listener: (output: SandboxCommandOutput) => void) {
          if (!settled) listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      });
    },
  });
}
