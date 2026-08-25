export interface ChildFsViteSample {
  readonly selfTimeSeconds: number;
}

export interface ChildFsExpressSample {
  readonly startToListeningMs: number;
}

export interface ChildFsArtifactSample {
  readonly vite: ChildFsViteSample;
  readonly express: ChildFsExpressSample;
  readonly [key: string]: unknown;
}

export interface ChildFsArtifact {
  readonly schemaVersion: 1;
  readonly gitSha: string;
  readonly browserVersion: string;
  readonly scenarioDigest: string;
  readonly dependencyDigest: string;
  readonly runs: number;
  readonly samples: readonly ChildFsArtifactSample[];
}

export function buildChildFsArtifact(input: Readonly<Record<string, unknown>>): ChildFsArtifact;
export function validateChildFsArtifact(input: unknown): ChildFsArtifact;
