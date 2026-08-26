export interface ChildFsTerminalProof {
  readonly kind: 'child-exit' | 'worker-result';
  readonly complete: true;
}

export interface ChildFsViteSample {
  readonly exitCode: 0;
  readonly rawOutput: string;
  readonly emittedJavaScript: string;
  readonly marker: string;
  readonly transformedModules: number;
  readonly selfTimeSeconds: number;
}

export interface ChildFsExpressSample {
  readonly exitCode: 0;
  readonly rawOutput: string;
  readonly marker: string;
  readonly startToListeningMs: number;
}

export interface ChildFsArtifactSample {
  readonly lane: 'product-coi' | 'in-realm';
  readonly topology: 'owner-sync-rpc-kernel-child' | 'single-in-realm-worker';
  readonly ordinal: number;
  readonly ownerLoad: 'idle';
  readonly terminalProof: ChildFsTerminalProof;
  readonly vite: ChildFsViteSample;
  readonly express: ChildFsExpressSample;
}

export interface ChildFsArtifact {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly gitSha: string;
  readonly browserVersion: string;
  readonly scenarioDigest: string;
  readonly dependencyDigest: string;
  readonly runs: number;
  readonly samples: readonly ChildFsArtifactSample[];
}

export function buildChildFsArtifact(input: Readonly<Record<string, unknown>>): ChildFsArtifact;
export function validateChildFsArtifact(input: unknown): ChildFsArtifact;
