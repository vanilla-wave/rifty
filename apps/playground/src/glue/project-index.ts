/**
 * Owner-realm project index (ADR-0165): the on-disk source of truth for the
 * multi-project layout — `/scratch` (unnamed draft) + `/projects/<id>/` (named)
 * + this index json. Pure over a sync VFS (`Pick<FsSync,…>`); the owner drives
 * it through `syncMirror()`. Loud throws on corrupt JSON + an un-reconcilable
 * half-move (a Save crash that already lost a tree) — never a silent default.
 */
import { joinPath } from '@riftydev/vfs';

/** Active root selector: 'scratch' or a projectId. */
export type ActiveId = 'scratch' | string;
export interface Project {
  readonly id: string;
  readonly name: string;
  readonly starter: string;
  readonly editedAt: string;
}
export interface Scratch {
  readonly starter: string;
  readonly dirty: boolean;
  readonly editedAt: string;
}
export interface ProjectIndex {
  readonly activeId: ActiveId;
  readonly scratch: Scratch | null;
  readonly projects: readonly Project[];
}

/** The index json path under `base` (shared by the module + the bridge). */
export function INDEX_PATH(base: string): string {
  return joinPath(base, '.rifty-project-index.json');
}

/** Active ROOT for an id: 'scratch'→/scratch, id→/projects/<id> (ADR-0165 §4). */
export function rootForId(activeId: ActiveId): string {
  return activeId === 'scratch' ? '/scratch' : `/projects/${activeId}`;
}

import type { FsSync } from '@riftydev/vfs';
import { dirname, normalizePath } from '@riftydev/vfs';
import { isInstallStampPath } from './install-stamp.ts';

/** The sync-VFS surface the index module needs (owner `syncMirror()`). */
export type IndexFs = Pick<
  FsSync,
  | 'existsSync'
  | 'readFileBytesSync'
  | 'writeFileSync'
  | 'mkdirSync'
  | 'rmSync'
  | 'readdirSync'
  | 'statSyncOrNull'
  | 'renameSync'
>;

const enc = new TextEncoder();
const dec = new TextDecoder();

const EMPTY_INDEX: ProjectIndex = { activeId: 'scratch', scratch: null, projects: [] };

function isProject(v: unknown): v is Project {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.starter === 'string' &&
    typeof p.editedAt === 'string'
  );
}
function isScratch(v: unknown): v is Scratch {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.starter === 'string' && typeof s.dirty === 'boolean' && typeof s.editedAt === 'string'
  );
}

/** Read the index. Empty default when absent; THROWS on corrupt/invalid JSON. */
export function loadIndex(fs: IndexFs, base: string): ProjectIndex {
  const path = INDEX_PATH(base);
  if (!fs.existsSync(path)) return EMPTY_INDEX;
  let parsed: unknown;
  try {
    parsed = JSON.parse(dec.decode(fs.readFileBytesSync(path)));
  } catch (err) {
    throw new Error(
      `corrupt project index at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`corrupt project index at ${path}: not an object`);
  }
  const raw = parsed as Record<string, unknown>;
  if (typeof raw.activeId !== 'string')
    throw new Error(`corrupt project index at ${path}: activeId`);
  if (!Array.isArray(raw.projects) || !raw.projects.every(isProject)) {
    throw new Error(`corrupt project index at ${path}: projects`);
  }
  if (raw.scratch !== null && !isScratch(raw.scratch)) {
    throw new Error(`corrupt project index at ${path}: scratch`);
  }
  const index: ProjectIndex = {
    activeId: raw.activeId,
    scratch: raw.scratch,
    projects: raw.projects,
  };
  assertActiveIdHasProject(index, path);
  return index;
}

/** Write the index, flushed write-through (durable before return). */
export function writeIndex(fs: IndexFs, base: string, index: ProjectIndex): void {
  const path = INDEX_PATH(base);
  assertActiveIdHasProject(index, path);
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, enc.encode(`${JSON.stringify(index, null, 2)}\n`));
}

function assertActiveIdHasProject(index: ProjectIndex, path: string): void {
  if (index.activeId === 'scratch') return;
  if (index.projects.some((project) => project.id === index.activeId)) return;
  throw new Error(`corrupt project index at ${path}: activeId missing project ${index.activeId}`);
}

type ProjectSaveCopyEntry =
  | { readonly kind: 'dir'; readonly target: string }
  | { readonly kind: 'file'; readonly target: string; readonly data: Uint8Array };

function copyScratchTreeForSave(fs: IndexFs, dst: string): void {
  const plan: ProjectSaveCopyEntry[] = [];
  const visit = (from: string, to: string): void => {
    if (isInstallStampPath(from) || isInstallStampPath(to)) return;
    const st = fs.statSyncOrNull(from);
    if (!st) throw new Error(`saveScratchAsProject: missing ${from}`);
    if (st.isDirectory) {
      plan.push({ kind: 'dir', target: to });
      const children = [...fs.readdirSync(from)].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      for (const child of children) {
        if (child.isDirectory && child.name === 'node_modules') continue;
        visit(joinPath(from, child.name), joinPath(to, child.name));
      }
      return;
    }
    plan.push({ kind: 'file', target: to, data: fs.readFileBytesSync(from).slice() });
  };
  visit('/scratch', dst);

  for (const entry of plan) {
    if (entry.kind === 'dir') fs.mkdirSync(entry.target, { recursive: true });
    else {
      fs.mkdirSync(dirname(entry.target), { recursive: true });
      fs.writeFileSync(entry.target, entry.data);
    }
  }
}

/**
 * Commit the active scratch as a named project (ADR-0165 §7) WITHOUT deleting the
 * source. This is the durable cut: copy /scratch → /projects/<id>, then flip the
 * index pointer. A crash after this commit leaves stale /scratch, which
 * recoverIndex case (B) finishes. Owner bridge uses this so the Save ack only
 * waits for the saved project + index, not for deleting derived node_modules.
 */
export function commitScratchProjectSave(
  fs: IndexFs,
  index: ProjectIndex,
  id: string,
  name: string,
): ProjectIndex {
  if (!index.scratch) throw new Error('saveScratchAsProject: no scratch to save');
  const dst = rootForId(id);
  if (fs.existsSync(dst))
    throw new Error(`saveScratchAsProject: project ${id} already exists at ${dst}`);

  // 1. copy (recursive) — leaves /scratch intact for crash-safety. Stamped
  // node_modules are derived from a baked/install snapshot and are restored on
  // boot; copying them blocks the owner on tens of MB during Save.
  copyScratchTreeForSave(fs, dst);

  // 2. flip the pointer + persist — the durable commit point.
  const project: Project = {
    id,
    name,
    starter: index.scratch.starter,
    editedAt: new Date().toISOString(),
  };
  const next: ProjectIndex = {
    activeId: id,
    scratch: null,
    projects: [...index.projects, project],
  };
  writeIndex(fs, '/', next);
  return next;
}

export function cleanupCommittedScratchSource(fs: IndexFs, index: ProjectIndex): void {
  if (index.activeId !== 'scratch' && index.scratch === null && fs.existsSync('/scratch')) {
    fs.rmSync('/scratch', { recursive: true, force: true });
  }
}

/**
 * Convert the active scratch into a named project (ADR-0165 §7). NON-ATOMIC
 * tree move on OPFS, so the ordering is the safety contract:
 *   1. copy  /scratch  → /projects/<id>      (recursive)
 *   2. flip  the index pointer + persist     ← durable commit
 *   3. delete /scratch                        (source removed only after commit)
 * A crash between 1 and 2 leaves an un-indexed /projects/<id> (recoverIndex
 * rolls it back); between 2 and 3 leaves a stale /scratch (recoverIndex finishes
 * the delete). Either way no tree is lost. `base='/'` — the index sits beside
 * the trees (rootForId paths are absolute).
 */
export function saveScratchAsProject(
  fs: IndexFs,
  index: ProjectIndex,
  id: string,
  name: string,
): ProjectIndex {
  const next = commitScratchProjectSave(fs, index, id, name);
  cleanupCommittedScratchSource(fs, next);
  return next;
}

export interface ProjectIndexRecoveryDeletion {
  readonly root: string;
  readonly reason: 'orphan-project' | 'stale-scratch';
}

export interface ProjectIndexRecoverySynthesis {
  readonly base: string;
  readonly index: ProjectIndex;
}

export interface ProjectIndexRecoveryPlan {
  readonly index: ProjectIndex;
  readonly deletions: readonly ProjectIndexRecoveryDeletion[];
  readonly synthesis: ProjectIndexRecoverySynthesis | null;
}

/**
 * Pure boot preflight for both Save crash windows. Validates every indexed tree
 * before exposing deterministic deletions, so callers can revoke package state
 * for each exact root before applying it. `starter` also plans cold-scratch index
 * synthesis; planning never writes.
 */
export function planProjectIndexRecovery(
  fs: IndexFs,
  base: string,
  options: { readonly starter?: string } = {},
): ProjectIndexRecoveryPlan {
  const index = loadIndex(fs, base);

  // Validate the complete authoritative set before producing any action.
  for (const project of index.projects) {
    if (!fs.existsSync(rootForId(project.id))) {
      throw new Error(
        `recoverIndex: project ${project.id} indexed but its tree ${rootForId(project.id)} is missing`,
      );
    }
  }

  const deletions: ProjectIndexRecoveryDeletion[] = [];
  const indexed = new Set(index.projects.map((p) => p.id));
  if (fs.existsSync('/projects')) {
    const orphanIds = fs
      .readdirSync('/projects')
      .filter((dirent) => dirent.isDirectory && !indexed.has(dirent.name))
      .map((dirent) => dirent.name)
      .sort();
    for (const id of orphanIds) {
      deletions.push({ root: rootForId(id), reason: 'orphan-project' });
    }
  }

  if (index.activeId !== 'scratch' && index.scratch === null && fs.existsSync('/scratch')) {
    deletions.push({ root: '/scratch', reason: 'stale-scratch' });
  }

  const synthesis =
    options.starter !== undefined &&
    index.activeId === 'scratch' &&
    index.scratch === null &&
    fs.existsSync('/scratch')
      ? {
          base,
          index: {
            ...index,
            scratch: {
              starter: options.starter,
              dirty: false,
              editedAt: 'no edits yet',
            },
          },
        }
      : null;

  return { index, deletions, synthesis };
}

/** Apply one deletion after its caller has revoked package state for `root`. */
export function applyProjectIndexRecoveryDeletion(
  fs: IndexFs,
  deletion: ProjectIndexRecoveryDeletion,
): void {
  fs.rmSync(deletion.root, { recursive: true, force: true });
}

/** Persist the separately planned cold-scratch index entry. */
export function applyProjectIndexRecoverySynthesis(
  fs: IndexFs,
  synthesis: ProjectIndexRecoverySynthesis,
): ProjectIndex {
  writeIndex(fs, synthesis.base, synthesis.index);
  return synthesis.index;
}

/**
 * Convenience reconcile for callers that do not own package state. Production
 * boot uses the plan/apply seam so each deletion follows package revocation.
 */
export function recoverIndex(fs: IndexFs, base: string): ProjectIndex {
  const plan = planProjectIndexRecovery(fs, base);
  for (const deletion of plan.deletions) {
    applyProjectIndexRecoveryDeletion(fs, deletion);
  }

  return plan.index;
}

/**
 * Owner boot reconcile (ADR-0165 §7). Run BEFORE the owner serves the index:
 *   1. recoverIndex — finish/roll back a half-completed Save (a crash between
 *      copy / flip-pointer / delete).
 *   2. When `/scratch` exists but the on-disk index is a cold-boot empty
 *      (`scratch:null, activeId:'scratch'`), synthesize+persist a scratch entry
 *      keyed on the spawn `starter` — so the owner index becomes the REAL source
 *      the page mirror hydrates from AND saveScratchAsProject's
 *      `if(!index.scratch) throw` precondition holds.
 * Only touches a scratch-active spawn (a project spawn already has its entry; a
 * published scratch is never overwritten). Returns the reconciled index.
 */
export function reconcileOwnerIndexAtBoot(fs: IndexFs, starter: string): ProjectIndex {
  const plan = planProjectIndexRecovery(fs, '/', { starter });
  for (const deletion of plan.deletions) {
    applyProjectIndexRecoveryDeletion(fs, deletion);
  }
  return plan.synthesis ? applyProjectIndexRecoverySynthesis(fs, plan.synthesis) : plan.index;
}

/**
 * Seed the scratch tree from a re-derived Starter bundle (ADR-0165 §6).
 * `files` = `{ '/scratch/relPath': content }` — already-rooted ABSOLUTE paths as
 * produced by `seedFilesForStarter(starter, '/scratch')` (no re-prefix here).
 * IDEMPOTENT per file: an existing file (a returning session) is left alone —
 * mirrors `seedProject` in real-vite-bootstrap.ts so a warm scratch survives.
 */
export function seedScratch(fs: IndexFs, files: Record<string, string>): void {
  fs.mkdirSync('/scratch', { recursive: true });
  for (const [abs, content] of Object.entries(files)) {
    const path = normalizePath(abs);
    fs.mkdirSync(dirname(path), { recursive: true });
    if (!fs.existsSync(path)) fs.writeFileSync(path, enc.encode(content));
  }
}

/**
 * Wipe a root tree then write the Starter bundle back (the shared mechanism
 * behind scratch + named-project Reset, ADR-0165 §6). Wiping first drops edits
 * AND stray files (incl. node_modules → the next dev boot re-installs clean).
 * `files` are already-rooted ABSOLUTE paths under `root`.
 */
function reseedTree(fs: IndexFs, root: string, files: Record<string, string>): void {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  for (const [abs, content] of Object.entries(files)) {
    const path = normalizePath(abs);
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(path, enc.encode(content));
  }
}

/**
 * One-shot WHOLE-workspace re-seed of /scratch from the Starter bundle
 * (ADR-0165 §6 Reset) — equivalent to re-picking the Starter: the tree is wiped
 * first so edits AND stray files are gone, then the baseline is written back.
 * `files` are the same already-rooted ABSOLUTE paths as `seedScratch`.
 */
export function resetScratchToStarter(fs: IndexFs, files: Record<string, string>): void {
  reseedTree(fs, '/scratch', files);
}

/**
 * One-shot WHOLE-tree re-seed of a NAMED project's `/projects/<id>` from its
 * Starter bundle (ADR-0165 §6 Reset, extended to named projects) — the exact
 * scratch-reset semantics applied at the project root, so "Reset to starter" on
 * a saved project is a real on-disk restore, not a page-mirror no-op. `files`
 * are already-rooted ABSOLUTE paths from `seedFilesForStarter(starter, rootForId(id))`.
 */
export function resetProjectToStarter(
  fs: IndexFs,
  projectId: string,
  files: Record<string, string>,
): void {
  reseedTree(fs, rootForId(projectId), files);
}
