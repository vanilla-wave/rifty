import type {
  NodeCliPlaygroundPlan,
  NodeServerPlaygroundPlan,
  NpmDevServerPlaygroundPlan,
  PlaygroundFirstMaterialization,
  PlaygroundProjectPlan,
  VitePlaygroundPlan,
} from '@riftydev/workbench/playground';
import { type Starter, seedFilesForStarter } from '../glue/starter.ts';
import type { PresetSetup } from '../presets.ts';
import { resolveProjectSpec } from '../templates/registry.ts';

const SEED_ROOT = '/__rifty_playground_plan__';

export interface PlaygroundProjectPlanInput {
  readonly projectId: string;
  readonly starter: Starter;
  readonly setup: PresetSetup;
}

function projectFiles(starter: Starter): Readonly<Record<string, string>> {
  const seeded = seedFilesForStarter(starter, SEED_ROOT);
  const files: Record<string, string> = {};
  for (const [path, contents] of Object.entries(seeded)) {
    if (!path.startsWith(`${SEED_ROOT}/`)) {
      throw new TypeError(`Starter seed escaped its project root: ${path}`);
    }
    files[path.slice(SEED_ROOT.length)] = contents;
  }
  return Object.freeze(files);
}

function copyStringMap(value: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(Object.entries(value)));
}

function firstMaterialization(
  setup: PresetSetup,
  spec: ReturnType<typeof resolveProjectSpec>,
): PlaygroundFirstMaterialization {
  if (setup === 'from-scratch') return Object.freeze({ kind: 'install' as const });
  if (spec.bakedNodeModulesUrl === undefined || spec.bakedNodeModulesSnapshotId === undefined) {
    throw new TypeError(`instant template ${spec.id} requires an exact baked snapshot descriptor`);
  }
  return Object.freeze({
    kind: 'snapshot' as const,
    snapshot: Object.freeze({
      snapshotId: spec.bakedNodeModulesSnapshotId,
      assetUrl: spec.bakedNodeModulesUrl,
      templateId: spec.bakedNodeModulesTemplateId ?? spec.id,
    }),
  });
}

export function toPlaygroundProjectPlan(input: PlaygroundProjectPlanInput): PlaygroundProjectPlan {
  if (input.starter.starter !== input.starter.id) {
    throw new TypeError('Starter durable self identity must equal its registry id');
  }
  const spec = resolveProjectSpec(input.starter.templateId ?? 'vite');
  const common = {
    id: input.projectId,
    starterId: input.starter.id,
    templateId: spec.id,
    files: projectFiles(input.starter),
    dependencies: copyStringMap(spec.install),
    ...(spec.devDependencies === undefined
      ? {}
      : { devDependencies: copyStringMap(spec.devDependencies) }),
    firstMaterialization: firstMaterialization(input.setup, spec),
  } as const;
  if (spec.runtime === 'vite') {
    return Object.freeze({
      ...common,
      kind: 'vite',
      port: spec.defaultPort,
    }) satisfies VitePlaygroundPlan;
  }
  if (spec.runtime === 'node-server') {
    return Object.freeze({
      ...common,
      kind: 'node-server',
      entryPath: spec.entry.relativePath,
      port: spec.defaultPort,
    }) satisfies NodeServerPlaygroundPlan;
  }
  if (spec.runtime === 'npm-dev-server') {
    return Object.freeze({
      ...common,
      kind: 'npm-dev-server',
    }) satisfies NpmDevServerPlaygroundPlan;
  }
  return Object.freeze({
    ...common,
    kind: 'node-cli',
    entryPath: spec.entry.relativePath,
    args: Object.freeze([]),
  }) satisfies NodeCliPlaygroundPlan;
}
