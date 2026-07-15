interface ProjectPackageConfigBase {
  readonly root: string;
  readonly entryPath: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly installDeps: Readonly<Record<string, string>>;
  readonly packageJson: string;
  readonly seedFiles: Readonly<Record<string, string>>;
  readonly bakedNodeModulesUrl?: string;
  readonly bakedNodeModulesTemplateId?: string;
}

export interface VitePackageConfig extends ProjectPackageConfigBase {
  readonly runtime: 'vite';
  readonly port: number;
}

export interface NodeServerPackageConfig extends ProjectPackageConfigBase {
  readonly runtime: 'node-server';
  readonly port: number;
}

export interface NodeCliPackageConfig extends ProjectPackageConfigBase {
  readonly runtime: 'node-cli';
}

export type ProjectPackageConfig =
  | VitePackageConfig
  | NodeServerPackageConfig
  | NodeCliPackageConfig;
