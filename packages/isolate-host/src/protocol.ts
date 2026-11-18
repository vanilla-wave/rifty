/** Parent ↔ child IPC (Node `serialization: 'advanced'`). Internal. */
export interface RunRequest {
  readonly type: 'run';
  readonly code: string;
  readonly memoryLimitMb: number;
  readonly maxRssBytes: number;
  readonly maxOutputBytes: number;
}

export type ChildMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'output'; readonly chunks: readonly (readonly [1 | 2, Uint8Array])[] }
  | { readonly type: 'exit'; readonly exitCode: number; readonly truncated: boolean }
  | { readonly type: 'memory'; readonly truncated: boolean }
  | { readonly type: 'error'; readonly message: string };
