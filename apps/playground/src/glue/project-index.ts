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
import { EMPTY_LIFECYCLE_BASELINE_ID } from './empty-lifecycle-baseline.ts';

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

/**
 * Make the already-live `/scratch` owner a real hidden empty Scratch after the
 * first-run launcher is dismissed. ADOPT, never re-seed: bytes created through
 * the real pre-pick shell survive. Existing scratch/project state wins so a
 * close racing the first owner index can never replace persisted work.
 */
export function adoptHiddenEmptyScratch(
  fs: IndexFs,
  base: string,
  index: ProjectIndex,
): ProjectIndex {
  if (index.activeId !== 'scratch' || index.scratch !== null) return index;

  fs.mkdirSync('/scratch', { recursive: true });
  const dirty = fs.readdirSync('/scratch').length > 0;
  const next: ProjectIndex = {
    ...index,
    scratch: {
      starter: EMPTY_LIFECYCLE_BASELINE_ID,
      dirty,
      editedAt: dirty ? new Date().toISOString() : 'no edits yet',
    },
  };
  writeIndex(fs, base, next);
  return next;
}

function assertActiveIdHasProject(index: ProjectIndex, path: string): void {
  if (index.activeId === 'scratch') return;
  if (index.projects.some((project) => project.id === index.activeId)) return;
  throw new Error(`corrupt project index at ${path}: activeId missing project ${index.activeId}`);
}

/**
 * Sync slug-rewrite of a moved tree's install stamp (ADR-0165). The async twin
 * is install-stamp.ts `restampSlug`; the Save move is SYNC over FsSync, so it
 * must not split across an await (a half-move window is exactly the corruption
 * §7 guards against). No-op when the tree has no stamp (a never-installed
 * scratch); a malformed stamp is treated as absent (matches readInstallStamp).
 */
function restampSlugSync(fs: IndexFs, root: string, slug: string): void {
  const path = `${root}/node_modules/.rifty-install-stamp.json`;
  if (!fs.existsSync(path)) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(dec.decode(fs.readFileBytesSync(path)));
  } catch {
    return; // malformed stamp → treat as absent (matches readInstallStamp)
  }
  if (!parsed || typeof parsed !== 'object') return;
  const next = { ...(parsed as Record<string, unknown>), slug };
  fs.writeFileSync(path, enc.encode(`${JSON.stringify(next, null, 2)}\n`));
}

function hasStampedNodeModules(fs: IndexFs, root: string): boolean {
  return fs.existsSync(`${root}/node_modules/.rifty-install-stamp.json`);
}

function copyScratchTreeForSave(fs: IndexFs, dst: string): void {
  const skipDerivedNodeModules = hasStampedNodeModules(fs, '/scratch');
  const copy = (from: string, to: string): void => {
    const st = fs.statSyncOrNull(from);
    if (!st) throw new Error(`saveScratchAsProject: missing ${from}`);
    if (st.isDirectory) {
      fs.mkdirSync(to, { recursive: true });
      for (const child of fs.readdirSync(from)) {
        if (from === '/scratch' && child.name === 'node_modules' && skipDerivedNodeModules) {
          continue;
        }
        copy(joinPath(from, child.name), joinPath(to, child.name));
      }
      return;
    }
    fs.mkdirSync(dirname(to), { recursive: true });
    fs.writeFileSync(to, fs.readFileBytesSync(from));
  };
  copy('/scratch', dst);
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

  // If an unstamped node_modules was copied, leave it alone; if a stamped one
  // is ever copied by a future path, re-key it before the project becomes active.
  restampSlugSync(fs, dst, id);

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

/**
 * Boot-time reconcile of a half-completed Save (ADR-0165 §7). The Save ordering
 * is copy → flip-pointer → delete, so exactly two crash windows exist:
 *   - AFTER copy, BEFORE flip → a `/projects/<id>` tree the index never recorded.
 *     The flip never committed → the move is CANCELLED: delete the orphan.
 *   - AFTER flip, BEFORE delete → the index records `<id>` but a stale `/scratch`
 *     lingers. The commit landed → FINISH it: delete the stale source.
 * An indexed project whose tree is ABSENT is real data loss → THROW (never drop
 * the entry silently). Returns the reconciled index (disk-side fixes only).
 */
export function recoverIndex(fs: IndexFs, base: string): ProjectIndex {
  const index = loadIndex(fs, base);

  // (D) every indexed project MUST have its tree — absence is loud data loss.
  for (const project of index.projects) {
    if (!fs.existsSync(rootForId(project.id))) {
      throw new Error(
        `recoverIndex: project ${project.id} indexed but its tree ${rootForId(project.id)} is missing`,
      );
    }
  }

  // (A) orphan /projects/<id> trees not in the index = an aborted copy → roll back.
  const indexed = new Set(index.projects.map((p) => p.id));
  if (fs.existsSync('/projects')) {
    for (const dirent of fs.readdirSync('/projects')) {
      if (dirent.isDirectory && !indexed.has(dirent.name)) {
        fs.rmSync(rootForId(dirent.name), { recursive: true, force: true });
      }
    }
  }

  // (B) committed Save (activeId is a project) with a stale /scratch lingering → finish the delete.
  cleanupCommittedScratchSource(fs, index);

  // A/B mutate disk only (the index is already correct) — return it as-loaded.
  return index;
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
  recoverIndex(fs, '/');
  const index = loadIndex(fs, '/');
  if (index.activeId === 'scratch' && index.scratch === null && fs.existsSync('/scratch')) {
    const next: ProjectIndex = {
      ...index,
      scratch: { starter, dirty: false, editedAt: 'no edits yet' },
    };
    writeIndex(fs, '/', next);
    return next;
  }
  return index;
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
