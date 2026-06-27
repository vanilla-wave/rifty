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
import { type RunResult, Shell } from '@riftydev/shell';
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

function assertGitOk(command: string, result: RunResult): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `${command} failed with ${result.exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
}

/**
 * Make a freshly-seeded Starter look like a normal project checkout: one real
 * root commit on `main`, clean worktree, generated files left ignored.
 */
export async function ensureStarterInitialCommit(vfs: Vfs, root: string): Promise<void> {
  const sh = new Shell({ cwd: root });
  if (!(await vfs.exists(`${root}/.git/HEAD`))) {
    assertGitOk('git init', await sh.run('git init'));
  }
  const log = await sh.run('git log --oneline');
  if (log.exitCode === 0 && log.stdout.trim() !== '') return;

  const status = await sh.run('git status --porcelain');
  assertGitOk('git status --porcelain', status);
  if (status.stdout.trim() === '') return;

  assertGitOk('git add .', await sh.run('git add .'));
  assertGitOk(
    `git commit -m "${INITIAL_COMMIT_MESSAGE}"`,
    await sh.run(`git commit -m "${INITIAL_COMMIT_MESSAGE}"`),
  );
}
