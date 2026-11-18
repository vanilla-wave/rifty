/** Parent ↔ child IPC (Node `serialization: 'advanced'`). Internal; the parent validates every child message. */
export interface RunRequest {
  readonly type: 'run';
  readonly code: string;
  readonly memoryLimitMb: number;
  readonly maxRssBytes: number;
  readonly maxOutputBytes: number;
}

export type ChildMessage =
  | { readonly type: 'ready' }
  | {
      readonly type: 'output';
      /** At most one chunk per fd. */
      readonly chunks: readonly (readonly [1 | 2, Uint8Array])[];
      readonly truncated: boolean;
    }
  | { readonly type: 'exit'; readonly exitCode: number; readonly truncated: boolean }
  | { readonly type: 'memory'; readonly truncated: boolean }
  | { readonly type: 'error'; readonly message: string };
