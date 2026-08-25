export interface ChildFsCliOptions {
  readonly runs: number;
  readonly out: string;
  readonly port: number;
  readonly ownerLoad: 'idle';
}

export interface ChildFsArtifactIo {
  mkdir(path: string): unknown;
  writeFile(path: string, json: string): unknown;
  rename(from: string, to: string): unknown;
  unlink(path: string): unknown;
}

export function parseChildFsArgs(argv: readonly string[]): ChildFsCliOptions;
export function assertChildFsPortFree(port: number): Promise<void>;
export function publishChildFsArtifact(path: string, json: string, io?: ChildFsArtifactIo): void;
