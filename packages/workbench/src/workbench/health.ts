export type WorkbenchRecoveryScope = 'scm' | 'preview' | 'persistence' | 'reload';

export type WorkbenchHealthIssue =
  | {
      readonly kind: 'degraded';
      readonly scope: 'scm' | 'preview' | 'persistence';
      readonly summary: string;
      readonly recovery: 'scm' | 'preview' | 'persistence';
    }
  | {
      readonly kind: 'unavailable';
      readonly scope: 'owner';
      readonly summary: string;
      readonly recovery: 'reload';
    }
  | {
      readonly kind: 'fatal';
      readonly scope: 'invariant';
      readonly summary: string;
      readonly recovery: 'reload';
    };

export interface WorkbenchProjectOpenProgress {
  readonly projectId: string;
  /** Counts for one real persistence drain, not the whole opening operation. */
  readonly persistence?: { readonly persisted: number; readonly total: number };
}

export interface WorkbenchHealthSnapshot {
  readonly projectOpen?: WorkbenchProjectOpenProgress;
  readonly disposition: 'healthy' | 'degraded' | 'unavailable' | 'fatal';
  readonly issues: readonly WorkbenchHealthIssue[];
}

export interface WorkbenchHealth {
  snapshot(): WorkbenchHealthSnapshot;
  subscribe(listener: (snapshot: WorkbenchHealthSnapshot) => void): () => void;
  recover(scope: WorkbenchRecoveryScope): Promise<void>;
}
