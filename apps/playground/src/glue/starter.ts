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
import { makeGit, requireSupportedStatusEntries, vfsToGitFs } from '@riftydev/git';
import type { Vfs } from '@riftydev/vfs';
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

const INITIAL_COMMIT_MESSAGE = 'Initial commit';
const GENERATED_BASELINE_FILES = new Set(['package-lock.json']);

function initialCommitAuthor(): {
  readonly name: string;
  readonly email: string;
  readonly timestamp: number;
  readonly timezoneOffset: number;
} {
  return {
    name: 'rifty',
    email: 'rifty@localhost',
    timestamp: Math.floor(Date.now() / 1000),
    timezoneOffset: 0,
  };
}

async function headCommitExists(g: ReturnType<typeof makeGit>): Promise<boolean> {
  try {
    await g.resolveRef('HEAD');
    return true;
  } catch {
    return false;
  }
}

async function stageInitialTree(g: ReturnType<typeof makeGit>): Promise<boolean> {
  const changed = requireSupportedStatusEntries(await g.status());
  for (const entry of changed) {
    if (entry.status === '111') continue;
    if (entry.status === '101' || entry.status === '100') await g.remove(entry.filepath);
    else await g.add(entry.filepath);
  }
  return changed.some((entry) => entry.status !== '111');
}

async function stageGeneratedBaseline(g: ReturnType<typeof makeGit>): Promise<boolean> {
  const changed = requireSupportedStatusEntries(await g.status());
  let staged = false;
  for (const entry of changed) {
    if (!GENERATED_BASELINE_FILES.has(entry.filepath) || entry.status === '111') continue;
    if (entry.status === '101' || entry.status === '100') await g.remove(entry.filepath);
    else await g.add(entry.filepath);
    staged = true;
  }
  return staged;
}

async function hasSingleInitialCommit(g: ReturnType<typeof makeGit>): Promise<boolean> {
  try {
    const log = await g.log({ depth: 2 });
    return log.length === 1 && log[0]?.message.trim() === INITIAL_COMMIT_MESSAGE;
  } catch {
    return false;
  }
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

  const author = initialCommitAuthor();
  await g.commit({ message: INITIAL_COMMIT_MESSAGE, author, committer: author });
}

/**
 * Fold generated baseline artifacts produced after first seed (currently npm's
 * package-lock.json) into the Starter's single root commit. Only amends the
 * untouched one-commit Starter history and only stages known generated files,
 * so real user edits stay visible.
 */
export async function amendStarterGeneratedBaseline(vfs: Vfs, root: string): Promise<void> {
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: root });
  if (!(await hasSingleInitialCommit(g))) return;
  if (!(await stageGeneratedBaseline(g))) return;

  const author = initialCommitAuthor();
  await g.commit({ message: INITIAL_COMMIT_MESSAGE, author, committer: author, amend: true });
}
