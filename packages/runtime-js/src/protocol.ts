/**
 * Message protocol between the host (main thread) and a runtime Worker.
 *
 * Versioned by string discriminator; never changed in place — when the shape
 * grows incompatibly, add a new `type` rather than mutating an existing one.
 */

export interface EvalRequest {
  readonly id: number;
  readonly code: string;
  /** Optional VFS root path the eval treats as the current working directory. */
  readonly cwd?: string;
}

export type EvalResult =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | {
      readonly id: number;
      readonly ok: false;
      readonly error: { readonly name: string; readonly message: string; readonly stack?: string };
    };

export type HostMessage =
  | { readonly type: 'eval'; readonly request: EvalRequest }
  | { readonly type: 'ping' }
  | { readonly type: 'load-fixture'; readonly files: Readonly<Record<string, string>> };

export type WorkerMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'stdout'; readonly chunk: string }
  | { readonly type: 'stderr'; readonly chunk: string }
  | { readonly type: 'result'; readonly result: EvalResult }
  | { readonly type: 'pong' };
