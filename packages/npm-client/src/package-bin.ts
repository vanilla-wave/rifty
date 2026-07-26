import { type Vfs, joinPath, normalizePath } from '@riftydev/vfs';

export interface PackageBinOwner {
  readonly name: string;
  readonly installPath: string;
  readonly bin?: string | Readonly<Record<string, string>>;
}

const shimEncoder = new TextEncoder();

export async function linkPackageBins(
  vfs: Vfs,
  root: string,
  pkg: PackageBinOwner,
  checkpoint: () => void = () => {},
): Promise<void> {
  const bins = normalizeBin(pkg.name, pkg.bin);
  const entries = Object.entries(bins);
  if (entries.length === 0) return;

  const packageRoot = joinPath(root, pkg.installPath);
  const binDir = joinPath(root, packageNodeModulesDir(pkg.installPath, pkg.name), '.bin');
  await vfs.mkdir(binDir, { recursive: true });
  checkpoint();
  for (const [command, target] of entries) {
    checkpoint();
    const relTarget = normalizeBinTarget(target);
    await vfs.readFile(joinPath(packageRoot, relTarget));
    checkpoint();
    const shim = `#!/usr/bin/env node\nimport('../${pkg.name}/${relTarget}');\n`;
    await vfs.writeFile(joinPath(binDir, command), shimEncoder.encode(shim));
    checkpoint();
  }
}

function packageNodeModulesDir(installPath: string, packageName: string): string {
  const suffix = `node_modules/${packageName}`;
  if (!installPath.endsWith(suffix)) {
    throw new Error(`Invalid package installPath for ${packageName}: ${installPath}`);
  }
  return installPath.slice(0, installPath.length - packageName.length - 1);
}

function normalizeBin(name: string, bin: PackageBinOwner['bin']): Readonly<Record<string, string>> {
  if (!bin) return {};
  if (typeof bin === 'string') return { [defaultBinName(name)]: bin };
  const out: Record<string, string> = {};
  for (const [command, target] of Object.entries(bin)) {
    if (command.includes('/') || command === '' || typeof target !== 'string' || target === '') {
      continue;
    }
    out[command] = target;
  }
  return out;
}

function defaultBinName(name: string): string {
  return name.startsWith('@') ? (name.split('/')[1] ?? name) : name;
}

function normalizeBinTarget(target: string): string {
  const normalized = normalizePath(target.replace(/^\.\//, ''));
  if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Invalid package bin target: ${target}`);
  }
  return normalized;
}
