/**
 * Preset→Starter map (ADR-0165 §1/§6). A Starter IS today's `Preset` viewed as
 * the immutable gallery bundle + the re-derivable reset baseline; this thin map
 * keeps the index/lifecycle layers off the `Preset` shape directly.
 *
 * `seedFilesForStarter(starter, root)` re-derives the COMPLETE on-disk bundle for
 * a root: the template's seed files (package.json/index.html/entry/extraFiles via
 * `resolveBootstrapConfig`) with the Preset's `files[]` overlaid under the root.
 * NO stored per-project artifact, so the reset baseline survives reload and can't
 * drift.
 */
import { PRESETS, type Preset } from '../presets.ts';
import { resolveBootstrapConfig } from '../templates/project-spec.ts';
import { defaultProjectSpec, resolveProjectSpec } from '../templates/registry.ts';

/** Launcher gallery group (ADR-0165 §1, design §2b): FRONT-END / SERVER / WASM. */
export type StarterGroup = 'frontend' | 'server' | 'wasm';

/**
 * preset.category → launcher group, for Vite/front-end presets. Node-runtime
 * presets (node-server / node-cli) are grouped by their resolved runtime in
 * {@link groupForPreset} instead — the display category alone can't distinguish
 * them (a node-server and a Vite app can both be `'Live preview'`).
 */
export const GROUP_FOR_CATEGORY: Readonly<Record<string, StarterGroup>> = {
  'Files + modules': 'frontend',
  'Live preview': 'frontend',
};

/**
 * Launcher gallery group for a preset. Node-runtime templates land under SERVER
 * (a `node-server` HTTP app or a `node-cli` run-to-completion program is NOT a
 * Vite dev server); everything else maps off the display category. Derived from
 * the resolved template runtime — the single source of truth — so the group can
 * never drift from what the preset actually runs.
 */
export function groupForPreset(preset: Preset): StarterGroup {
  if (preset.templateId !== undefined) {
    try {
      const runtime = resolveProjectSpec(preset.templateId).runtime;
      if (runtime === 'node-server' || runtime === 'node-cli') return 'server';
    } catch {
      // Unknown template id — fall back to the category map below.
    }
  }
  return GROUP_FOR_CATEGORY[preset.category] ?? 'frontend';
}

export interface Starter {
  readonly id: string;
  readonly name: string;
  readonly starter: string; // self-id; the value `Project.starter` records
  /** Registered template id (ADR-0078) the Starter seeds from; undefined → default. */
  readonly templateId?: string;
  readonly files: readonly { readonly path: string; readonly content: string }[];
}

export function starterFromPreset(preset: Preset): Starter {
  return {
    id: preset.id,
    name: preset.label,
    starter: preset.id,
    templateId: preset.templateId,
    files: preset.files,
  };
}

export function starterById(id: string): Starter {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`unknown starter ${id}`);
  return starterFromPreset(preset);
}

/**
 * Absolute-path → contents map for `root`, re-derived from the Starter bundle
 * (the reset baseline + the first-seed of a fresh tree). Template seed files come
 * from `resolveBootstrapConfig`; the Preset `files[]` overlays ordinary files
 * under the root (leading slash tolerated).
 */
export function seedFilesForStarter(starter: Starter, root: string): Record<string, string> {
  const spec = starter.templateId ? resolveProjectSpec(starter.templateId) : defaultProjectSpec();
  const cfg = resolveBootstrapConfig(spec, spec.defaultPort, root);
  const entryPath = spec.entry.relativePath.replace(/^\/+/, '');
  if (!starter.files.some((file) => file.path.replace(/^\/+/, '') === entryPath)) {
    throw new Error(`starter ${starter.id} is missing entry file ${entryPath}`);
  }
  const files: Record<string, string> = { ...cfg.seedFiles };
  for (const f of starter.files) {
    const rel = f.path.startsWith('/') ? f.path : `/${f.path}`;
    files[`${root}${rel}`] = f.content;
  }
  return files;
}
