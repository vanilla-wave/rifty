interface ProjectPackageConfigBase {
  readonly root: string;
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
  readonly entryPath: string;
  readonly port: number;
}

export interface NpmDevServerPackageConfig extends ProjectPackageConfigBase {
  readonly runtime: 'npm-dev-server';
}

export interface NodeServerPackageConfig extends ProjectPackageConfigBase {
  readonly runtime: 'node-server';
  readonly entryPath: string;
  readonly port: number;
}

export interface NodeCliPackageConfig extends ProjectPackageConfigBase {
  readonly runtime: 'node-cli';
  readonly entryPath: string;
}

export type ProjectPackageConfig =
  | VitePackageConfig
  | NpmDevServerPackageConfig
  | NodeServerPackageConfig
  | NodeCliPackageConfig;
