/**
 * Preset→Starter map (ADR-0165 §1/§6). A Starter IS today's `Preset` viewed as
 * the immutable gallery bundle + the re-derivable reset baseline; this thin map
 * keeps the index/lifecycle layers off the `Preset` shape directly. The mapping
 * PRESERVES the preset `.source` object reference (express-sqlite / socket-lab
 * share theirs with the template entry — a test pins that identity), so we copy
 * the ref, never the string.
 *
 * `seedFilesForStarter(starter, root)` re-derives the COMPLETE on-disk bundle for
 * a root: the template's seed files (package.json/index.html/entry/extraFiles via
 * `resolveBootstrapConfig`) with the Preset's editor `source` overlaid at the
 * entry path + the Preset's `files[]` overlaid under the root. NO stored
 * per-project artifact, so the reset baseline survives reload and can't drift.
 */
import { makeGit, vfsToGitFs } from '@riftydev/git';
import type { Vfs } from '@riftydev/vfs';
import { PRESETS, type Preset } from '../presets.ts';
import { resolveBootstrapConfig } from '../templates/project-spec.ts';
import { defaultProjectSpec, resolveProjectSpec } from '../templates/registry.ts';

/** Launcher gallery group (ADR-0165 §1, design §2b): FRONT-END / SERVER / WASM. */
export type StarterGroup = 'frontend' | 'server' | 'wasm';

/**
 * preset.category → launcher group. Today every preset is a Vite/front-end
 * bundle, so both registered categories map to `frontend`; SERVER/WASM groups
 * exist for the next starter families. The launcher derives a Starter's group
 * via `GROUP_FOR_CATEGORY[starter-category]` (no `group` field is stored on the
 * Starter — it's a pure lookup off the preset category).
 */
export const GROUP_FOR_CATEGORY: Readonly<Record<string, StarterGroup>> = {
  'Files + modules': 'frontend',
  'Live preview': 'frontend',
};

export interface Starter {
  readonly id: string;
  readonly name: string;
  readonly starter: string; // self-id; the value `Project.starter` records
  /** Program source — the SAME object ref the preset holds (no copy). */
  readonly source: string;
  /** Registered template id (ADR-0078) the Starter seeds from; undefined → default. */
  readonly templateId?: string;
  readonly files: readonly { readonly path: string; readonly content: string }[];
}

export function starterFromPreset(preset: Preset): Starter {
  return {
    id: preset.id,
    name: preset.label,
    starter: preset.id,
    source: preset.source, // SHARED ref preserved
    templateId: preset.templateId,
    files: preset.files ?? [],
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
 * from `resolveBootstrapConfig`; the Preset `source` overwrites the template's
 * stub entry; the Preset `files[]` overlay under the root (leading slash tolerated).
 */
export function seedFilesForStarter(starter: Starter, root: string): Record<string, string> {
  const spec = starter.templateId ? resolveProjectSpec(starter.templateId) : defaultProjectSpec();
  const cfg = resolveBootstrapConfig(spec, spec.defaultPort, root);
  const files: Record<string, string> = { ...cfg.seedFiles };
  // The Preset's editor source IS the entry the user opens — overwrite the
  // template's stub entry with it (matches the page's seedWorkspaceOwner).
  files[cfg.entryPath] = starter.source;
  for (const f of starter.files) {
    const rel = f.path.startsWith('/') ? f.path : `/${f.path}`;
    files[`${root}${rel}`] = f.content;
  }
  return files;
}

const INITIAL_COMMIT_MESSAGE = 'Initial commit';

async function headCommitExists(g: ReturnType<typeof makeGit>): Promise<boolean> {
  try {
    await g.resolveRef('HEAD');
    return true;
  } catch {
    return false;
  }
}

async function stageInitialTree(g: ReturnType<typeof makeGit>): Promise<boolean> {
  const changed = await g.status();
  for (const entry of changed) {
    if (entry.status === '111') continue;
    if (entry.status === '101' || entry.status === '100') await g.remove(entry.filepath);
    else await g.add(entry.filepath);
  }
  return changed.some((entry) => entry.status !== '111');
}

/**
 * Make a freshly-seeded Starter look like a normal project checkout: one real
 * root commit on `main`, clean worktree, generated files left ignored.
 */
export async function ensureStarterInitialCommit(vfs: Vfs, root: string): Promise<void> {
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: root });
  if (!(await vfs.exists(`${root}/.git/HEAD`))) await g.init();
  if (await headCommitExists(g)) return;

  const hasChanges = await stageInitialTree(g);
  if (!hasChanges) return;

  const timestamp = Math.floor(Date.now() / 1000);
  const author = {
    name: 'rifty',
    email: 'rifty@localhost',
    timestamp,
    timezoneOffset: 0,
  };
  await g.commit({ message: INITIAL_COMMIT_MESSAGE, author, committer: author });
}
