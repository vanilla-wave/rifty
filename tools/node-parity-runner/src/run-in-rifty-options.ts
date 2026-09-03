import type { NodeCliEvalVfsMutation } from './node-cli-eval-vfs-observer.ts';

export type NodeCliEvalVfsFault =
  | 'child-local-transient-decoder-file'
  | 'child-local-transient-source-file'
  | 'sab-remote-transient-source-file'
  | 'workbench-owner-transient-source-file';

export interface NodeCliEvalVfsProbe {
  readonly expectedGuestMutations: readonly NodeCliEvalVfsMutation[];
  readonly fault?: NodeCliEvalVfsFault;
}

export type NodeCliEvalBootstrapFault =
  | 'wrong-protocol'
  | 'missing-source'
  | 'missing-print'
  | 'missing-exec-argv'
  | 'missing-remote-fs'
  | 'source-not-string'
  | 'print-not-boolean'
  | 'exec-argv-not-array'
  | 'remote-fs-not-boolean'
  | 'extra-launch-field'
  | 'exec-argv-first-not-string'
  | 'exec-argv-middle-not-string'
  | 'exec-argv-last-not-string'
  | 'program-bin'
  | 'program-node-serve'
  | 'program-ipc';

export interface NodeCliEvalPreviewExpectation {
  readonly port: number;
  readonly status: number;
  readonly body: string;
}

export type NodeCliEvalPreviewProbe = Readonly<Record<string, NodeCliEvalPreviewExpectation>>;
export type PhysicalStdioDeliveryFault = 'stderr-before-two-stdout';
export type NodeCliEvalPreEntryFault = 'quickjs-readiness-rejection';

export interface RunInRiftyOptions {
  /** Same-realm fault-injection seam for the browser MessageChannel boundary. */
  readonly createMessageChannel?: () => MessageChannel;
  /** Receiver-side deadline for processing the stdin EOF transport frame. */
  readonly stdinTimeoutMs?: number;
  /** Parent-owned execution deadline; settlement still awaits Worker termination. */
  readonly caseTimeoutMs?: number;
  /** Physical eval-only source-carrier audit; serializable across the disposable Worker. */
  readonly nodeCliEvalVfsProbe?: NodeCliEvalVfsProbe;
  /** Physical eval-only scoped-preview audit; serializable across the disposable Worker. */
  readonly nodeCliEvalPreviewProbe?: NodeCliEvalPreviewProbe;
  /** Physical eval-only raw corrupt-input injection, downstream of the host builder. */
  readonly nodeCliEvalBootstrapFault?: NodeCliEvalBootstrapFault;
  /** Physical eval-only async pre-entry rejection at the QuickJS readiness boundary. */
  readonly nodeCliEvalPreEntryFault?: NodeCliEvalPreEntryFault;
  /** Physical cross-port delivery inversion; leaves control IPC FIFO intact. */
  readonly physicalStdioDeliveryFault?: PhysicalStdioDeliveryFault;
}
