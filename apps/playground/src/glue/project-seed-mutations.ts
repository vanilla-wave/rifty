import { type FsSync, type VfsMutationIntent, normalizePath } from '@riftydev/vfs';
import { isSegmentContained } from './project-seed-paths.ts';
import { isViteConfigSlotPath, viteConfigSeedClaimPath } from './vite-config-seed.ts';

interface ProjectSeedMutationInput {
  readonly root: string;
  readonly seedFiles: Readonly<Record<string, string>>;
  readonly baselineFiles: Readonly<Record<string, string>>;
  readonly freshRoot: boolean;
}

/** Exact file-level owner seed writes; derived node_modules never belongs to seeding. */
export function projectSeedMutationIntents(
  fs: Pick<FsSync, 'existsSync'>,
  input: ProjectSeedMutationInput,
): readonly VfsMutationIntent[] {
  const paths = new Set<string>([viteConfigSeedClaimPath(input.root)]);
  const nodeModules = normalizePath(`${input.root}/node_modules`);

  for (const path of Object.keys(input.seedFiles)) {
    const normalized = normalizePath(path);
    if (isSegmentContained(normalized, nodeModules)) continue;
    if (
      !fs.existsSync(normalized) ||
      input.freshRoot ||
      isViteConfigSlotPath(normalized, input.root)
    ) {
      paths.add(normalized);
    }
  }

  const readme = normalizePath(`${input.root}/README.md`);
  if (!fs.existsSync(readme)) paths.add(readme);
  if (input.freshRoot) {
    for (const path of Object.keys(input.baselineFiles)) {
      const normalized = normalizePath(path);
      if (!isSegmentContained(normalized, nodeModules)) paths.add(normalized);
    }
  }

  return [...paths]
    .sort((left, right) => left.localeCompare(right))
    .map((path) => ({ kind: 'write', path }));
}
