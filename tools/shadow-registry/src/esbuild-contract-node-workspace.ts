import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import {
  type EsbuildContractWorkspace,
  explicitContractRelativePath,
} from './esbuild-contract-probe.ts';

function listFiles(path: string): readonly string[] {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path)
    .flatMap((entry) => listFiles(join(path, entry)))
    .sort();
}

export interface NodeContractWorkspaceOptions {
  readonly baseDirectory?: string;
  readonly rootSuffix?: string;
}

export async function withNodeContractWorkspace<T>(
  run: (workspace: EsbuildContractWorkspace) => Promise<T>,
  options: NodeContractWorkspaceOptions = {},
): Promise<T> {
  const baseDirectory = options.baseDirectory ?? tmpdir();
  const container = mkdtempSync(join(baseDirectory, '.rifty-esbuild-contract-'));
  const root = options.rootSuffix ? join(container, options.rootSuffix) : container;
  mkdirSync(root, { recursive: true });
  const realRoot = realpathSync(root);
  const cwd = process.cwd();
  const relativeRoot = explicitContractRelativePath(relative(cwd, root).replaceAll('\\', '/'));
  const relativeRealRoot = explicitContractRelativePath(
    relative(cwd, realRoot).replaceAll('\\', '/'),
  );
  const workspace: EsbuildContractWorkspace = {
    root,
    cwd,
    relativeRoot,
    rootAliases: [...new Set([root, realRoot, relativeRoot, relativeRealRoot])],
    mkdir: async (path) => {
      mkdirSync(path, { recursive: true });
    },
    writeFile: async (path, contents) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents);
    },
    readFile: async (path) => readFileSync(path, 'utf8'),
    exists: existsSync,
    listFiles,
  };
  try {
    return await run(workspace);
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
}
