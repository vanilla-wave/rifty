/** Playground presentation adapter over the package-owned Starter model. */
import {
  type WorkbenchStarter,
  amendStarterGeneratedBaseline,
  ensureStarterInitialCommit,
  resolveStarter,
  seedFilesForStarter as seedWorkbenchStarterFiles,
} from '@riftydev/workbench';
import type { Preset } from '../presets.ts';
import { resolveProjectSpec } from '../templates/registry.ts';
import { PLAYGROUND_PROJECT_CATALOG } from './workbench-catalog.ts';

export { amendStarterGeneratedBaseline, ensureStarterInitialCommit };

/** Launcher gallery group (ADR-0165 §1). */
export type StarterGroup = 'frontend' | 'server' | 'wasm';

export const GROUP_FOR_CATEGORY: Readonly<Record<string, StarterGroup>> = {
  'Files + modules': 'frontend',
  'Live preview': 'frontend',
};

export function groupForPreset(preset: Preset): StarterGroup {
  if (preset.templateId !== undefined) {
    const runtime = resolveProjectSpec(preset.templateId).runtime;
    if (runtime === 'node-server' || runtime === 'node-cli') return 'server';
  }
  return GROUP_FOR_CATEGORY[preset.category] ?? 'frontend';
}

/** App compatibility field `starter` is presentation-only; package workers use id. */
export interface Starter extends WorkbenchStarter {
  readonly starter: string;
}

export function starterFromPreset(preset: Preset): Starter {
  const starter = resolveStarter(PLAYGROUND_PROJECT_CATALOG, preset.id);
  return { ...starter, starter: starter.id };
}

export function starterById(id: string): Starter {
  try {
    const starter = resolveStarter(PLAYGROUND_PROJECT_CATALOG, id);
    return { ...starter, starter: starter.id };
  } catch (error) {
    throw new Error(`unknown starter ${id}`, { cause: error });
  }
}

export function seedFilesForStarter(
  starter: WorkbenchStarter & { readonly starter?: string },
  root: string,
): Record<string, string> {
  return seedWorkbenchStarterFiles(PLAYGROUND_PROJECT_CATALOG, starter, root);
}
