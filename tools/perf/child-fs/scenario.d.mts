export interface ChildFsScenario {
  readonly id: 'child-fs-hot-path-v1';
  readonly root: '/bench';
  readonly dependencies: Readonly<Record<string, string>>;
  readonly files: Readonly<Record<string, string>>;
}

export function childFsScenario(): ChildFsScenario;
export function childFsScenarioIdentity(): {
  readonly scenarioDigest: string;
  readonly dependencyDigest: string;
};
