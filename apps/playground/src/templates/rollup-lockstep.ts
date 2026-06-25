interface LockfilePackageEntry {
  readonly version?: string;
}

export interface LockfileWithPackages {
  readonly packages: Readonly<Record<string, LockfilePackageEntry | undefined>>;
}

function lockfileVersion(lockfile: LockfileWithPackages, name: string): string | undefined {
  return lockfile.packages[`node_modules/${name}`]?.version;
}

export function assertRollupWasmNodeLockstep(
  templateId: string,
  lockfile: LockfileWithPackages,
): void {
  const wasmNodeVersion = lockfileVersion(lockfile, '@rollup/wasm-node');
  if (!wasmNodeVersion) return;

  const rollupVersion = lockfileVersion(lockfile, 'rollup');
  if (rollupVersion !== wasmNodeVersion) {
    throw new Error(
      `bake(${templateId}): rollup ${rollupVersion ?? '<missing>'} must match @rollup/wasm-node ${wasmNodeVersion}`,
    );
  }
}
