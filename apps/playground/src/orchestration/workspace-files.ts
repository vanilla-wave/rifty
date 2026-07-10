/**
 * Workspace file/archive orchestration — headless core extracted from App.tsx
 * (ADR-0197, epic playground-testable-core, slice 4). Owns the owner-routed
 * editor write (single store owner — the page holds no authoritative fs), the
 * starter re-seed that never clobbers the install-owned package.json, the
 * guarded single-file download, and the workspace archive export/import flows
 * (blocked while a dev server runs).
 *
 * No UI imports; DOM affordances (blob save, file picker) are injected ports —
 * the behavioral-test seam (ADR-0197 §4).
 */
import { basename } from '@riftydev/vfs';
import { seedFilesForStarter, starterById } from '../glue/starter.ts';
import type { Preset } from '../presets.ts';
import { isViteConfigSlotPath } from '../workers/vite-config-guard.ts';
import type { FileReadOwnerLike, OwnerFileReader } from './owner-file-read.ts';

const ownerWriteEnc = new TextEncoder();

/** Owner surface the files core drives (structural WorkspaceOwnerHandle subset). */
export interface FilesOwnerLike extends FileReadOwnerLike {
  writeFrameAcked(frame: {
    readonly type: 'write';
    readonly path: string;
    readonly data: Uint8Array;
    readonly ifAbsent?: boolean;
  }): Promise<unknown>;
  exportArchive(): Promise<string>;
  importArchive(text: string): Promise<unknown>;
}

export interface WorkspaceFilesDeps<O extends FilesOwnerLike> {
  currentOwner(): O;
  /** Guarded owner byte reads (shared with the SCM core). */
  reader: OwnerFileReader<O>;
  /** Editor-write gate: no real project chosen yet → refuse loud. */
  started(): boolean;
  /** ADR-0165 §57: a REAL owner write happened — the store binds dirty to this. */
  notifyFileWritten(path: string, content: string): void;
  flushEditorWrites(): Promise<void>;
  /** Archive export/import is blocked while a preset transition / dev server runs. */
  archiveBlocked(): boolean;
  /** Ask the owner to republish its snapshot (explorer/editor refresh after import). */
  requestVfsSnapshot(owner: O): void;
  activeRoot(): string;
  /** DOM blob-download affordance; false = no document here. */
  saveFile(name: string, mime: string, data: Uint8Array | string): boolean;
  /** DOM file-picker affordance; false = no document here. */
  pickArchiveFile(onPick: (text: () => Promise<string>) => void): boolean;
  showError(message: string): void;
  showSuccess(message: string): void;
}

export interface WorkspaceFiles {
  /** SSoT editor write (ADR-0148): flows to the ONE owner the dev server serves. */
  writeFile(path: string, content: string): Promise<void>;
  /**
   * Push starter files into the owner realm, acked before tabs reopen. Skips
   * the install-owned root package.json; `ifAbsent` (reload re-seed) never
   * clobbers a persisted edit.
   */
  seedOwner(preset: Preset, ifAbsent?: boolean): Promise<void>;
  downloadFile(path: string): Promise<void>;
  downloadArchive(): Promise<void>;
  importArchiveText(text: string): Promise<void>;
  chooseArchive(): void;
}

/** Create inside a reactive root (App component / `createRoot` in tests). */
export function createWorkspaceFiles<O extends FilesOwnerLike>(
  deps: WorkspaceFilesDeps<O>,
): WorkspaceFiles {
  const { reader } = deps;

  async function writeFile(path: string, content: string): Promise<void> {
    if (!deps.started()) {
      deps.showError('Choose a project before editing files');
      return;
    }
    await deps.currentOwner().writeFrameAcked({
      type: 'write',
      path,
      data: ownerWriteEnc.encode(content),
    });
    deps.notifyFileWritten(path, content); // ADR-0165 §57: REAL write → scratch dirty
  }

  async function seedOwner(preset: Preset, ifAbsent = false): Promise<void> {
    const root = deps.activeRoot();
    const rootPackageJsonPath = `${root}/package.json`;
    for (const [path, content] of Object.entries(
      seedFilesForStarter(starterById(preset.id), root),
    )) {
      // package.json is install-owned after boot; rewriting it here drops
      // npm-installed deps on reload while the owner/index reset already seeds it.
      if (path === rootPackageJsonPath) continue;
      // Reload re-seed must not resurrect a deleted template vite.config.js /
      // shadow a user's vite.config.* (deletion = the documented opt-out; the
      // owner's marker-provenance seed owns the config-slot decision —
      // claimTemplateViteConfigSeed in vite-config-guard.ts).
      if (ifAbsent && isViteConfigSlotPath(path, root)) continue;
      await deps.currentOwner().writeFrameAcked({
        type: 'write',
        path,
        data: ownerWriteEnc.encode(content),
        ...(ifAbsent ? { ifAbsent: true } : {}),
      });
    }
  }

  async function downloadFile(path: string): Promise<void> {
    try {
      await deps.flushEditorWrites();
      // Fresh OWNER bytes after the flush — never a stale page copy.
      const bytes = await reader.readBytes(deps.currentOwner(), path, 'download');
      if (!deps.saveFile(basename(path), 'application/octet-stream', bytes)) {
        throw new Error('file download is unavailable without a document');
      }
      deps.showSuccess(`${basename(path)} downloaded`);
    } catch (err) {
      deps.showError(`Download failed: ${(err as Error).message}`);
    }
  }

  async function downloadArchive(): Promise<void> {
    if (deps.archiveBlocked()) {
      deps.showError('Stop the dev server to archive the editable workspace');
      return;
    }
    try {
      // Debounced Monaco edits may still sit in the page queue — land them in
      // the owner tree first, or the archive silently omits the latest edit
      // while toasting success (same discipline as downloadFile).
      await deps.flushEditorWrites();
      // Single store owner, page holds no authoritative fs: serialize the OWNER
      // tree (the single store), not a page copy — so the archive includes
      // shell/CLI-authored files, full content (no cap).
      const archive = await deps.currentOwner().exportArchive();
      if (!deps.saveFile('rifty-workspace.json', 'application/vnd.rifty.workspace+json', archive)) {
        deps.showError('Workspace archive download is unavailable here');
        return;
      }
      deps.showSuccess('Workspace archive downloaded');
    } catch (err) {
      deps.showError(`Archive download failed: ${(err as Error).message}`);
    }
  }

  async function importArchiveText(text: string): Promise<void> {
    try {
      // Land pending debounced edits BEFORE the import: a queued editor write
      // firing after importArchive would clobber the freshly imported file with
      // the pre-import editor bytes; flushed first, the archive content wins.
      await deps.flushEditorWrites();
      // Apply into the OWNER tree, then pull a fresh snapshot so the
      // explorer/editor reflect it (no page store to write).
      const owner = deps.currentOwner();
      await owner.importArchive(text);
      deps.requestVfsSnapshot(owner);
      deps.showSuccess('Workspace archive imported');
    } catch (err) {
      deps.showError(`Import failed: ${(err as Error).message}`);
    }
  }

  function chooseArchive(): void {
    if (deps.archiveBlocked()) {
      deps.showError('Stop the dev server to import into the editable workspace');
      return;
    }
    const picked = deps.pickArchiveFile((text) => {
      // `text()` (the File read) can reject after the pick — same loud toast as
      // any import failure, never an unhandled rejection.
      void (async (): Promise<void> => {
        try {
          await importArchiveText(await text());
        } catch (err) {
          deps.showError(`Import failed: ${(err as Error).message}`);
        }
      })();
    });
    if (!picked) deps.showError('Workspace archive import is unavailable here');
  }

  return { writeFile, seedOwner, downloadFile, downloadArchive, importArchiveText, chooseArchive };
}
