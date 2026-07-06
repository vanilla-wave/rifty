import { isSabIpcSupported } from '@riftydev/kernel';
import { detectCapabilities } from '@riftydev/runtime-js/env/capabilities';
import type { TerminalRawInput } from '@riftydev/terminal';
import {
  type TerminalHistoryMode,
  type TerminalHistoryRecord,
  addTerminalHistoryRecord,
} from '@riftydev/terminal/history';
import type { TerminalDevCommand } from '@riftydev/terminal/state';
import type { Diagnostic } from '@riftydev/ts-language-service/lsp-types';
import { joinPath } from '@riftydev/vfs';
import * as monaco from 'monaco-editor';
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import {
  type TerminalRunDimensions,
  type TerminalSessionSnapshot,
  createTerminalManager,
} from './adapters/terminal-manager.ts';
import { useLayout } from './adapters/useLayout.ts';
import { useMode } from './adapters/useMode.ts';
import { type BootResult, isCrossOriginIsolated, swErrorBannerMessage } from './boot.ts';
import { BottomPanel } from './components/BottomPanel.tsx';
import { CapabilitiesPanel } from './components/CapabilitiesPanel.tsx';
import { CommandPalette, type PaletteItem } from './components/CommandPalette.tsx';
import { DegradedBanner } from './components/DegradedBanner.tsx';
import { type EditorApi, type EditorDocumentEvent, EditorHost } from './components/EditorHost.tsx';
import { FileExplorer, type FileExplorerMutations } from './components/FileExplorer.tsx';
import { Launcher } from './components/Launcher.tsx';
import { PreviewPanel } from './components/PreviewPanel.tsx';
import { ProjectDialogs } from './components/ProjectDialogs.tsx';
import { ProjectSwitcherChip } from './components/ProjectSwitcherChip.tsx';
import type { RowAction } from './components/ProjectsTab.tsx';
import { ScmPanel } from './components/ScmPanel.tsx';
import { Splitter } from './components/Splitter.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import type { TerminalModeHint } from './components/TerminalPanel.tsx';
import { Icon } from './components/icons.tsx';
import { DELETE_GRACE_MS, createAppProjectStore } from './glue/app-project-store.ts';
import { resetBrowserSandboxState } from './glue/browser-sandbox-reset.ts';
import { copyToClipboard } from './glue/clipboard.ts';
import {
  degradedBannerVisible,
  saveAffordance,
  storageModeFromBoot,
} from './glue/degraded-storage.ts';
import { readChildren } from './glue/file-tree.ts';
import { bridgeGitOwnerRpc } from './glue/git-owner-port.ts';
import { requestGitStatus, subscribeGitStatus } from './glue/git-status-feed.ts';
import { initialEditorFilesForPreset } from './glue/initial-editor-files.ts';
import { initialLauncherTab, loadLauncherTab, saveLauncherTab } from './glue/launcher-prefs.ts';
import { NodeModulesCache } from './glue/node-modules-cache.ts';
import { bridgeNodeModulesReads } from './glue/node-modules-port.ts';
import { OwnerRpcFs } from './glue/owner-rpc-fs.ts';
import { parsePresetDeepLink } from './glue/preset-deep-link.ts';
import { hasPersistedProjectHint, recordProjectPresenceHint } from './glue/project-boot-policy.ts';
import { scratchDisplayName } from './glue/project-display-name.ts';
import {
  bridgeProjectIndex,
  deleteProjectTree,
  markScratchDirtyIndex,
  newScratchIndex,
  renameProjectIndex,
  resetProjectIndex,
  resetScratchIndex,
  saveProjectIndexPhases,
  setActiveIndex,
} from './glue/project-index-port.ts';
import { type ActiveId, rootForId } from './glue/project-index.ts';
import {
  type WorkspaceOwnerHandle,
  startWorkspaceOwner,
  wirePreviewBridge,
} from './glue/realVite.ts';
import { workspaceVfsPrefix } from './glue/scoped-vfs.ts';
import { SnapshotFs } from './glue/snapshot-fs.ts';
import { type StarterGroup, seedFilesForStarter, starterById } from './glue/starter.ts';
import { pathFromTerminalFileLink } from './glue/terminal-links.ts';
import type { TerminalPersistence } from './glue/terminal-persistence.ts';
import { terminalWelcomeBanner } from './glue/terminal-welcome-banner.ts';
import { createTsDiagnosticsSync } from './glue/ts-diagnostics-sync.ts';
import { createTsLanguageServiceClient, lspToMonacoMarkers } from './glue/ts-ls-client.ts';
import {
  clearTsLsInitDiagnostics,
  shouldPublishTsLsInitDiagnostic,
  upsertTsLsInitDiagnostic,
} from './glue/ts-ls-init-diagnostic.ts';
import { registerTsLanguageServiceProviders } from './glue/ts-ls-monaco-providers.ts';
import {
  type VfsSnapshotEntry,
  requestVfsSnapshot,
  subscribeVfsSnapshot,
} from './glue/vfs-snapshot-port.ts';
import { createDevServerLifecycle } from './orchestration/dev-server-lifecycle.ts';
import { createOwnerFileReader } from './orchestration/owner-file-read.ts';
import { createPresetBoot } from './orchestration/preset-boot.ts';
import { createProjectIndexBoot } from './orchestration/project-index-boot.ts';
import { createResetRefresh } from './orchestration/reset-refresh.ts';
import { createSaveFlow } from './orchestration/save-flow.ts';
import { createScm } from './orchestration/scm.ts';
import { createTerminalStatePersistence } from './orchestration/terminal-state-persistence.ts';
import { createWorkspaceFiles } from './orchestration/workspace-files.ts';
import { createWorkspaceLifecycle } from './orchestration/workspace-lifecycle.ts';
import {
  DEFAULT_PRESET,
  PRESETS,
  type Preset,
  presetBootLines,
  restoreBootLines,
} from './presets.ts';
import { HIDDEN_EMPTY_TEMPLATE } from './templates/hidden-empty.ts';
import type { ProjectSpec } from './templates/project-spec.ts';
import { defaultProjectSpec, resolveProjectSpec } from './templates/registry.ts';

// Re-export the App project-store factory (ADR-0165 §57/§56). It lives in glue so
// the node vitest env can unit-test it without importing this browser-only module
// (xterm → `self is not defined`); App.tsx exposes it under its public name too.
export { createAppProjectStore } from './glue/app-project-store.ts';

/** BroadcastChannel key the unavailable-owner stub reports; never served. */
const UNAVAILABLE_OWNER_PORT = -1;
const OWNER_UNAVAILABLE_MSG =
  'shell needs cross-origin isolation (SAB IPC) — serve the playground with COOP/COEP headers (vite.config.ts ships them)\n';
const WORKSPACE_ID_SESSION_KEY = 'rifty.workspaceId';
const fatalDec = new TextDecoder('utf-8', { fatal: true });
const ownerWriteEnc = new TextEncoder();

function createWorkspaceId(): string {
  return `ws-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)}`;
}

function loadWorkspaceId(storage: Storage | undefined = globalThis.sessionStorage): string {
  try {
    const existing = storage?.getItem(WORKSPACE_ID_SESSION_KEY);
    if (existing) return existing;
    const next = createWorkspaceId();
    storage?.setItem(WORKSPACE_ID_SESSION_KEY, next);
    return next;
  } catch {
    return createWorkspaceId();
  }
}

/**
 * Fail-loud {@link WorkspaceOwnerHandle} for a non-isolated host (ADR-0146:
 * no PAGE shell fallback in the single-store-owner model). `openSession` resolves so the terminal
 * manager never hangs; `exec` writes the requirement to stderr and exits 1.
 * No worker is spawned and no bridges are served.
 */
function createUnavailableOwner(): WorkspaceOwnerHandle {
  return {
    workspaceId: 'unavailable',
    root: '/scratch',
    previewOwnerToken: 'unavailable',
    snapshotPort: UNAVAILABLE_OWNER_PORT,
    ready: Promise.resolve(),
    closed: Promise.resolve(0),
    openSession: () => Promise.resolve(),
    exec: (_sid, _line, opts) => {
      opts.onChunk(OWNER_UNAVAILABLE_MSG, 'stderr');
      return Promise.resolve(1);
    },
    writeStdin: () => {},
    signal: () => {},
    closeSession: () => {},
    isAlive: () => false,
    writeFile: () => {},
    writeFrame: () => {
      throw new Error(OWNER_UNAVAILABLE_MSG);
    },
    writeFrameAcked: () => Promise.reject(new Error(OWNER_UNAVAILABLE_MSG)),
    flushDurable: () => Promise.reject(new Error(OWNER_UNAVAILABLE_MSG)),
    exportArchive: () => Promise.reject(new Error(OWNER_UNAVAILABLE_MSG)),
    importArchive: () => Promise.reject(new Error(OWNER_UNAVAILABLE_MSG)),
    readFileBytes: () => Promise.reject(new Error(OWNER_UNAVAILABLE_MSG)),
    snapshot: () => ({ cwd: '/scratch', env: {} }),
    onDevServer: () => () => {},
    onPreview: () => () => {},
    requestPreview: () => {},
    setDevConfig: () => Promise.resolve(),
    sendTsLsp: () => {},
    onTsLsp: () => () => {},
    close: () => {},
  };
}

function createHiddenEmptyWorkspaceOwner(): WorkspaceOwnerHandle {
  return isSabIpcSupported()
    ? startWorkspaceOwner({
        workspaceId: loadWorkspaceId(),
        root: '/scratch',
        template: HIDDEN_EMPTY_TEMPLATE,
        slug: 'scratch',
        starter: DEFAULT_PRESET.id,
        setup: 'instant',
        hiddenEmptyBoot: true,
        onLog: (line) => console.info(line),
      })
    : createUnavailableOwner();
}

export interface AppProps {
  /**
   * Bundle from `bootstrapPlayground()`: VFS backend descriptor (ADR-0013) plus
   * an optional SW-registration error. App never re-registers the SW itself.
   */
  readonly boot: BootResult;
  readonly terminalPersistence: TerminalPersistence;
}

export function App(props: AppProps) {
  const capabilities = detectCapabilities();
  const [swBannerDismissed, setSwBannerDismissed] = createSignal(false);
  // ADR-0165 §4: `activePreset` is now ONLY the fallback STARTER seed (the active
  // starter is `activeStarterId()`, store-derived); the active id/root follow the
  // store (`activeRoot` below). Kept as the seed pick + switch-write target.
  const [activePreset, setActivePreset] = createSignal(DEFAULT_PRESET.id);
  const workspaceId = loadWorkspaceId();
  const workspacePrefix = workspaceVfsPrefix(workspaceId);
  const globalForTests = globalThis as typeof globalThis & {
    __riftyWorkspaceId?: string;
    __riftyWorkspacePrefix?: string;
  };
  globalForTests.__riftyWorkspaceId = workspaceId;
  globalForTests.__riftyWorkspacePrefix = workspacePrefix;

  // ── Page store + its prerequisites (ADR-0165 §9) — declared BEFORE `activeRoot`
  // so the root can follow `store.activeId()` (the single source of truth). The
  // store holds no fs handle; it mirrors the owner-published index + the boot probe.

  // ADR-0165 §8 degraded path: storage mode comes from the REAL one-time boot
  // probe (detectVfsBackend), not a manual toggle — the single source for the
  // store, the status-bar badge, the degraded banner gate, and the save copy.
  const storageMode = storageModeFromBoot(props.boot);
  const [bannerDismissed, setBannerDismissed] = createSignal(false);

  // ADR-0165 §57: DIRTY binds to a REAL owner file-write, never a UI counter. The
  // owner handle exposes no write event (writes ORIGINATE on the page through
  // `writeWorkspaceFile`), so the page IS the write source: a tiny notifier the
  // write path fires and the store subscribes to. This is the honest signal — a
  // write actually happened.
  const fileWriteListeners = new Set<(path: string, content: string) => void>();
  function notifyFileWritten(path: string, content: string): void {
    for (const cb of fileWriteListeners) cb(path, content);
  }
  const fileWriteOwner = {
    onFileWritten(cb: (path: string, content: string) => void): () => void {
      fileWriteListeners.add(cb);
      return () => fileWriteListeners.delete(cb);
    },
  };

  // ADR-0165 §9 page store: the multi-project mirror that drives the chip,
  // launcher, dialogs, and status bar. Hydrated from the owner-published index
  // mirror (`projectIndex()`); `storage` from the real boot backend. The
  // App-level wrapper binds dirty to `fileWriteOwner` (§57) and defers the on-disk
  // delete to the owner tree (§56). The cold-boot default index is empty: no
  // scratch/starter is chosen until the user picks one from the launcher.
  // `onDiskDelete`/`onScratchDirty` read `workspaceOwner()`/`indexBoot` LAZILY at
  // fire-time, so the store can be created here — before the full workspace owner
  // is spawned — with no TDZ hit.

  // `?preset=<id>&autorun=1` deep-link (shareable launch URL + the perf harness,
  // docs/backlog/perf/cold-start-and-install-benchmark): a cold tab BYPASSES the
  // project-first chooser and boots straight into the preset (onMount below).
  // Validated against the registry — an unknown/absent id → the project-first chooser.
  const presetDeepLink = parsePresetDeepLink(globalThis.location?.search ?? '');
  const deepLinkStarterId =
    presetDeepLink.presetId !== undefined &&
    PRESETS.some((preset) => preset.id === presetDeepLink.presetId)
      ? presetDeepLink.presetId
      : undefined;
  // A provided-but-unknown `?preset=<id>` (typo / stale share URL) would silently
  // fall through to the project-first chooser, looking like the link did nothing.
  // Surface it loudly so a broken link / a benchmark pointed at the wrong preset
  // is visible.
  if (presetDeepLink.presetId !== undefined && deepLinkStarterId === undefined) {
    console.warn(
      `[rifty] unknown preset "${presetDeepLink.presetId}" in ?preset= deep-link — ignoring it and showing the project chooser`,
    );
  }

  const store = createAppProjectStore({
    // Cold-boot default index is empty (no project chosen yet); the owner's first
    // publish hydrates the real one via the index-boot core below.
    index: {
      activeId: 'scratch',
      scratch: null,
      projects: [],
    },
    storage: storageMode,
    owner: fileWriteOwner,
    onScratchDirty: (starter) => {
      if (saveAffordance(storageMode).ephemeral) return;
      void markScratchDirtyIndex(workspaceOwner().snapshotPort, starter).catch((err: unknown) =>
        console.error('[project-index] mark scratch dirty failed', err),
      );
    },
    // §56: the page-mirror delete + Undo is REAL (launcher updates, restore works).
    // After the grace window the DURABLE removal of `/projects/<id>` is tracked +
    // posted by the index-boot core (re-fired across owner respawns, ADR-0165
    // §56). Fires at delete time, long after `indexBoot` below exists.
    onDiskDelete: (id) => indexBoot.recordOnDiskDelete(id),
  });

  // ADR-0165 §4: the active root follows the STORE — `store.activeId()` is the
  // single source of truth ('scratch' on boot; a projectId after switch; 'scratch'
  // after pickStarter). rootForId maps it to /scratch or /projects/<id>.
  const activeRoot = (): string => rootForId(store.activeId());

  // ADR-0165 §4: the active STARTER follows the store too (scratch→its starter,
  // project→its starter, fallback the activePreset seed) — drives presetForId /
  // presetBootLines / setDevConfig / spawn template+setup so the template/bootlines
  // never go stale after a switch.
  const activeStarterId = (): string => {
    const id = store.activeId();
    if (id === 'scratch') return store.scratch()?.starter ?? activePreset();
    return store.projects().find((p) => p.id === id)?.starter ?? activePreset();
  };

  const [activeFile, setActiveFile] = createSignal('');
  const [activeFilePath, setActiveFilePath] = createSignal<string | undefined>(undefined);
  const [activeLang, setActiveLang] = createSignal('plaintext');
  const [toast, setToast] = createSignal<{ message: string; tone: 'error' | 'success' } | null>(
    null,
  );
  const [paletteOpen, setPaletteOpen] = createSignal(false);

  const layout = useLayout();

  // Read-only mirror of the real-vite worker's project tree (ADR-0076). The
  // worker's VFS is a separate realm the page can't read directly, so it
  // publishes its tree (sans node_modules) over a BroadcastChannel; applied here.
  const snapshotFs = new SnapshotFs(activeRoot());

  let editorApi: EditorApi | undefined;
  // Reactive mirror so the LS-wiring effect (ADR-0166 P1.9b) reacts when the
  // editor registers its imperative api (captured during EditorHost mount).
  const [editorApiSig, setEditorApiSig] = createSignal<EditorApi | undefined>(undefined);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function flashToast(message: string, tone: 'error' | 'success'): void {
    setToast({ message, tone });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToast(null), tone === 'success' ? 2200 : 3800);
  }
  function flashError(message: string): void {
    flashToast(message, 'error');
  }

  async function share(): Promise<void> {
    const url = globalThis.location?.href ?? '';
    const copied = await copyToClipboard(url);
    // The link encodes none of the user's edits (real share-by-link is the M13
    // item) — the toast must not imply the project travels with it.
    if (copied) flashToast('Link copied — opens this playground', 'success');
    else flashToast('Could not copy the link to the clipboard', 'error');
  }

  function workspaceArchiveBlocked(): boolean {
    return presetBoot.transitioning() || devServer.status() !== 'stopped';
  }

  // Active real-project template (ADR-0078): follows the ACTIVE STARTER (store-
  // derived, ADR-0165 §4), so a node-server project boots ITS worker runtime, not
  // the registry default — and the template stays coherent after a switch. Chip +
  // mode machine read its generic display name.
  const templateForPreset = (preset: Preset): ProjectSpec =>
    preset.templateId ? resolveProjectSpec(preset.templateId) : defaultProjectSpec();

  const activeTemplate = (): ProjectSpec => templateForPreset(presetForId(activeStarterId()));
  let starterGeneratedBaselinePendingForNextOwner = false;

  function createActiveWorkspaceOwner(): WorkspaceOwnerHandle {
    const starterGeneratedBaselinePending = starterGeneratedBaselinePendingForNextOwner;
    starterGeneratedBaselinePendingForNextOwner = false;
    return isSabIpcSupported()
      ? startWorkspaceOwner({
          // ADR-0165 §4: root + slug follow the STORE's active id (scratch on boot,
          // a projectId after switch); template/setup follow the active STARTER.
          workspaceId,
          root: activeRoot(),
          template: activeTemplate(),
          slug: store.activeId(),
          starter: activeStarterId(),
          starterGeneratedBaselinePending,
          setup: presetForId(activeStarterId()).setup,
          onLog: (line) => console.info(line),
        })
      : createUnavailableOwner();
  }

  // Workspace owner signal (ADR-0146/0148/0165): cold boot starts with a hidden
  // empty /scratch owner. It gives the IDE a real shell before the launcher
  // choice, but the worker suppresses starter files + index scratch synthesis so
  // no visible project is chosen until the user picks one.
  // ADR-0165 §3: the owner is torn down + respawned on switch (RIFTY_RFV_ROOT is
  // frozen per spawn). Held in a signal so requestSwitch can swap it; every bridge
  // effect reads `workspaceOwner()` so the signal swap re-runs them — that swap IS
  // the re-wire to the new owner.
  const initialOwnerHandle = createHiddenEmptyWorkspaceOwner();
  const [ownerHandle, setOwnerHandle] = createSignal<WorkspaceOwnerHandle>(initialOwnerHandle);
  const workspaceOwner = (): WorkspaceOwnerHandle => ownerHandle();
  const ownerRpcFs = new OwnerRpcFs(snapshotFs, () => workspaceOwner());
  // A rename closes the open tabs under `from`; map each back to its path under
  // `to` so open editors follow the move (a file, or every file under a renamed
  // dir) instead of silently vanishing.
  function reopenTargetsForRename(from: string, to: string): readonly string[] {
    return (editorApi?.openPathsUnder(from) ?? []).map((path) => `${to}${path.slice(from.length)}`);
  }
  const explorerMutations: FileExplorerMutations = {
    createFile: (path) => ownerRpcFs.createFile(path),
    createDir: (path) => ownerRpcFs.createDir(path),
    async deletePath(path) {
      await flushPendingEditorWrites();
      editorApi?.closePathTree(path);
      await ownerRpcFs.deletePath(path);
    },
    async renamePath(from, to) {
      await flushPendingEditorWrites();
      const reopen = reopenTargetsForRename(from, to);
      editorApi?.closePathTree(from);
      await ownerRpcFs.renamePath(from, to);
      for (const path of reopen) editorApi?.openFile(path);
    },
    async renameMany(entries) {
      await flushPendingEditorWrites();
      const reopen = entries.flatMap(({ from, to }) => reopenTargetsForRename(from, to));
      for (const { from } of entries) editorApi?.closePathTree(from);
      await ownerRpcFs.renameMany(entries);
      for (const path of reopen) editorApi?.openFile(path);
    },
    async copyTree(from, to) {
      await flushPendingEditorWrites();
      await ownerRpcFs.copyTree(from, to);
    },
    async writeFile(path, data, options) {
      await flushPendingEditorWrites();
      await ownerRpcFs.writeFile(path, data, options);
      editorApi?.closePath(path);
    },
    async writeFiles(entries) {
      await flushPendingEditorWrites();
      await ownerRpcFs.writeFiles(entries);
      for (const { path } of entries) editorApi?.closePath(path);
    },
  };
  // Mode state machine owns UI state only. Real server lifetime belongs to the
  // visible `vite` terminal command.
  const machine = useMode({});

  // Dev-server lifecycle is OWNER-driven (ADR-0148) and lives in the extracted
  // orchestration core (`orchestration/dev-server-lifecycle.ts`, ADR-0197); the
  // `devServer` binding below (after the manager) wires its ports to the real
  // owner/terminal/machine. Preset transitions live in the preset-boot core
  // (`orchestration/preset-boot.ts`, slice 3) bound further below.
  const [tsProjectRevision, setTsProjectRevision] = createSignal(0);

  // The terminal shell + cwd/env + npm + bin all live in the persistent
  // workspace owner now (ADR-0146 owner-resident shell); the manager is a thin pty-channel client.
  const manager = createTerminalManager({
    owner: workspaceOwner(),
    // Restore persisted terminal state on load (ADR-0146): the shell is
    // owner-resident, so the seed travels to it over `pty:open`.
    initialState: {
      cwd: props.terminalPersistence.initialState.cwd,
      env: props.terminalPersistence.initialState.env,
    },
  });

  // Headless dev-server lifecycle core (ADR-0197) bound to the REAL ports: the
  // reactive owner handle, the page terminal manager (+ visibility state), the
  // exec funnel, the persisted dev command and the SW preview bridge. Effect
  // creation order is preserved (these mirrors precede every later bridge effect).
  const devServer = createDevServerLifecycle<TerminalSessionSnapshot>({
    terminal: {
      snapshot: (id) => manager.snapshot(id),
      activeSessionId: () => manager.activeSessionId(),
      select: (id) => manager.select(id),
      stop: (id) => manager.stop(id),
      freshConsole: (id, banner) => manager.freshConsole(id, banner),
      createSession: () => createSession(),
      refreshState: () => refreshTerminalState(),
      visibleSessions: () => visibleSessions(),
      isHidden: (id) => hiddenSessionIds.has(id),
    },
    runBootSequence: (id, lines) => runTerminalSequence(id, lines),
    executedLine: (sid) => lastExecutedLine.get(sid),
    persistDevCommand: (command) => terminalState.persistDevCommand(command),
    setRealVitePort: (port) => machine.setRealVitePort(port),
    onOwnerAlive: () => workspace.setOwnerReady(true),
    onServerRunningEdge: () => setTsProjectRevision((revision) => revision + 1),
    wirePreviewBridge,
    bootLines: (preset) => presetBootLines(preset, activeRoot()),
    activeStarterPreset: () => presetForId(activeStarterId()),
    templateForPreset,
    welcomeBanner: terminalWelcomeBanner,
  });
  // The ONLY reactive glue the lifecycle needs: (re)bind on every owner swap
  // (switch respawn re-runs this like every other bridge effect) + teardown.
  // Keyed on the owner signal alone — attachOwner untracks its own body.
  createEffect(() => {
    devServer.attachOwner(workspaceOwner());
  });
  onCleanup(() => devServer.dispose());
  void initialOwnerHandle.ready.catch((err: unknown) => {
    console.error('[workspace-owner] hidden empty boot failed', err);
  });

  // Headless workspace-owner lifecycle core (ADR-0197 slice 2) bound to the REAL
  // ports: the reactive owner handle, the terminal-manager rebind, the durable
  // index persist, the snapshot-frame readiness handshakes and the dev-server core.
  const workspace = createWorkspaceLifecycle<WorkspaceOwnerHandle>({
    initiallyStarted: initialOwnerHandle.workspaceId !== 'unavailable',
    currentOwner: () => workspaceOwner(),
    setOwner: (next) => setOwnerHandle(next),
    createActiveOwner: () => createActiveWorkspaceOwner(),
    spawnOwner: ({ root, slug }) =>
      startWorkspaceOwner({
        // template/setup follow the active STARTER, which the store already
        // re-pointed to the destination project (ADR-0165 §4).
        workspaceId,
        root,
        template: activeTemplate(),
        slug,
        starter: activeStarterId(),
        setup: presetForId(activeStarterId()).setup,
        onLog: (line) => console.info(line),
      }),
    rebindTerminal: (owner) => manager.rebindOwner(owner),
    awaitOwnerReady: (next) =>
      new Promise<void>((resolve) => {
        // REAL readiness gate (ADR-0165 §3): resolve on the new owner's FIRST
        // published snapshot frame — the owner serves the snapshot bridge only
        // after `bootShellOwner` has wired its pty/fs/index handlers, so a frame
        // means it is ready to take commands. A bounded timeout fallback prevents
        // a never-arriving frame from hanging the switch (the page→owner IPC also
        // buffers, so a late wire still self-recovers via each bridge's re-request).
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          unsub();
          clearTimeout(timer);
          resolve();
        };
        const unsub = subscribeVfsSnapshot(next.snapshotPort, () => finish());
        requestVfsSnapshot(next.snapshotPort);
        const timer = setTimeout(finish, 2000);
      }),
    awaitActiveSnapshotFrame: () => resetRefresh.waitForActiveSnapshotFrame(),
    flushEditorWrites: () => flushPendingEditorWrites(),
    // Memory mode has no durable index → the switch skips the activeId persist.
    ephemeralStorage: saveAffordance(storageMode).ephemeral,
    persistActiveId: async (id) => {
      await setActiveIndex(workspaceOwner().snapshotPort, id);
    },
    transition: {
      begin: () => presetBoot.beginTransition(),
      end: () => presetBoot.endTransition(),
    },
    devServer: {
      lifecycleRunning: () => devServer.lifecycleRunning(),
      sessionId: () => devServer.sessionId(),
      markStopped: () => devServer.markStopped(),
      restart: (sessionId) => devServer.restart(sessionId),
    },
    clearTerminal: (sessionId) => manager.clear(sessionId),
    resetEditorInitialFiles: () => resetEditorToActiveInitialFiles(),
    confirmDiscard: async () => globalThis.confirm?.('Discard unsaved scratch changes?') ?? true,
    showSwitchError: (text) => store.setToast({ kind: 'error', text }),
    relaunchDevServer: () => {
      // Serialize through the preset-transition queue like every other launch
      // (onPickStarter / applyPending) so a concurrent pick/archive can't race the
      // boot. The boot replays the RECORDED dev command of the previously running
      // session (a fork may have swapped the dev tool) — template boot lines when none.
      const preset = presetForId(activeStarterId());
      void presetBoot.queueTransition(() =>
        presetBoot.runPreset(
          preset,
          undefined,
          restoreBootLines(props.terminalPersistence.initialState.devCommand, preset, activeRoot()),
        ),
      );
    },
  });

  // Headless project-index + boot-decision core (ADR-0197 slice 2): the page
  // mirror of the owner-published index (the launcher renders from it), the
  // store-hydrate flow, §56 delete tracking and the one-shot first-run-chooser
  // vs reload-restore decision.
  const indexBoot = createProjectIndexBoot({
    hydrateIndex: (idx) => store.hydrateIndex(idx),
    recordPresenceHint: (idx) => recordProjectPresenceHint(idx, globalThis.localStorage),
    hasPresenceHint: () => hasPersistedProjectHint(globalThis.localStorage),
    // Read the port at fire time — an owner respawn (switch) moves the live channel.
    postDeleteProjectTree: (id) => deleteProjectTree(workspaceOwner().snapshotPort, id),
    openLauncherOnStarters: () => {
      store.setLauncherTab('starters');
      store.openLauncher();
    },
    closeLauncher: () => store.closeLauncher(),
    resetEditorInitialFiles: () => resetEditorToActiveInitialFiles(),
    restore: (idx) => void workspace.restoreOnReload(idx),
    pickDeepLinkStarter: (id) => void onPickStarter(id),
  });

  // Headless preset-boot core (ADR-0197 slice 3) bound to the REAL ports: the
  // dev-server core (dependency spine), the owner dev-config, the page terminal
  // echo loop, the picked-starter paint/seed glue and the TS re-init hook.
  const presetBoot = createPresetBoot<TerminalSessionSnapshot>({
    devServer: {
      lifecycleRunning: () => devServer.lifecycleRunning(),
      sessionId: () => devServer.sessionId(),
      pickSession: () => devServer.pickSession(),
      reserveSession: (session) => devServer.reserveSession(session),
      claimSession: (id) => devServer.claimSession(id),
      beginBoot: (id) => devServer.beginBoot(id),
      nextGeneration: () => devServer.nextGeneration(),
      currentGeneration: () => devServer.currentGeneration(),
      stopSession: (id) => devServer.stopSession(id),
      stopBeforeStarterWrite: () => devServer.stopBeforeStarterWrite(),
      startSession: (id, generation, preset, override) =>
        devServer.startSession(id, generation, preset, override),
      waitForPresetBoot: (id, generation, spec) =>
        devServer.waitForPresetBoot(id, generation, spec),
    },
    presetForId: (id) => presetForId(id),
    templateForPreset,
    bootLines: (preset) => presetBootLines(preset, activeRoot()),
    // `slug` keys the install stamp/RIFTY_RFV_SLUG to the ACTIVE ROOT
    // (store.activeId — 'scratch' on a gallery pick), matching the owner spawn;
    // `templateId`/`setup` follow the picked preset (ADR-0148).
    applyDevConfig: (preset) =>
      workspaceOwner().setDevConfig({
        templateId: templateForPreset(preset).id,
        slug: store.activeId(),
        setup: preset.setup,
      }),
    freshConsole: (id) => manager.freshConsole(id, terminalWelcomeBanner),
    runBootSequence: (id, lines) => runTerminalSequence(id, lines),
    reinitializeTs: () => reinitializeTsForPickedPreset(),
    dirtyScratchPick: () => store.activeId() === 'scratch' && store.scratch()?.dirty === true,
    setOwnerReady: (ready) => workspace.setOwnerReady(ready),
    paintStarterUi: (preset) => paintPickedStarterUi(preset),
    markEditorContextReady: () => indexBoot.setEditorProjectContextReady(true),
    noteStarterBaselinePending: () => {
      if (!workspace.started()) starterGeneratedBaselinePendingForNextOwner = true;
    },
    ensureOwnerStarted: () => workspace.ensureStarted(false),
    establishScratch: (id, opts) => durableNewScratch(id, opts),
    ephemeralStorage: saveAffordance(storageMode).ephemeral,
    seedWorkspace: (preset) => files.seedOwner(preset),
  });

  // Guarded owner byte reads shared by the files + SCM cores (ADR-0197 slice 4):
  // every read re-asserts the LIVE owner so a switch mid-read fails loud.
  const ownerFileReader = createOwnerFileReader<WorkspaceOwnerHandle>({
    currentOwner: () => workspaceOwner(),
    ownerUnavailable: (owner) => owner.snapshotPort === UNAVAILABLE_OWNER_PORT,
  });

  // Headless workspace files/archive core (ADR-0197 slice 4) bound to the REAL
  // ports: the owner write/read/archive surface, the §57 dirty notifier and the
  // DOM blob/picker affordances.
  const files = createWorkspaceFiles<WorkspaceOwnerHandle>({
    currentOwner: () => workspaceOwner(),
    reader: ownerFileReader,
    started: () => workspace.started(),
    notifyFileWritten,
    flushEditorWrites: () => flushPendingEditorWrites(),
    archiveBlocked: () => workspaceArchiveBlocked(),
    requestVfsSnapshot: (owner) => requestVfsSnapshot(owner.snapshotPort),
    activeRoot: () => activeRoot(),
    saveFile: (name, mime, data) => {
      const doc = globalThis.document;
      if (!doc) return false;
      const blob =
        typeof data === 'string'
          ? new Blob([data], { type: mime })
          : (() => {
              const blobBuffer = new ArrayBuffer(data.byteLength);
              new Uint8Array(blobBuffer).set(data);
              return new Blob([blobBuffer], { type: mime });
            })();
      const url = URL.createObjectURL(blob);
      const a = doc.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      return true;
    },
    pickArchiveFile: (onPick) => {
      const doc = globalThis.document;
      if (!doc) return false;
      const input = doc.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json,application/vnd.rifty.workspace+json';
      input.addEventListener(
        'change',
        () => {
          const file = input.files?.[0];
          if (file) onPick(() => file.text());
        },
        { once: true },
      );
      input.click();
      return true;
    },
    showError: flashError,
    showSuccess: (message) => flashToast(message, 'success'),
  });

  // Headless owner-backed SCM core (ADR-0197 slice 4, ADR-0185) bound to the
  // REAL ports: the owner git RPC bridge, the status feed, the editor diff
  // surface and the shared guarded reader.
  const scm = createScm<WorkspaceOwnerHandle>({
    currentOwner: () => workspaceOwner(),
    ownerUnavailable: (owner) => owner.snapshotPort === UNAVAILABLE_OWNER_PORT,
    reader: ownerFileReader,
    bridgeGit: (owner) => bridgeGitOwnerRpc(owner.snapshotPort),
    subscribeStatus: (owner, cb) => subscribeGitStatus(owner.snapshotPort, cb),
    requestStatus: (owner) => requestGitStatus(owner.snapshotPort),
    requestVfsSnapshot: (owner) => requestVfsSnapshot(owner.snapshotPort),
    joinRootPath: (root, path) => joinPath(root, path),
    editor: {
      openTextDiff: (spec) => editorApi?.openTextDiff(spec),
      openWorkingDiff: (spec) => editorApi?.openWorkingDiff(spec),
      closePath: (path) => editorApi?.closePath(path),
    },
    flushEditorWrites: () => flushPendingEditorWrites(),
    confirmDiscard: (message) => globalThis.confirm?.(message) ?? false,
    showError: flashError,
    showSuccess: (message) => flashToast(message, 'success'),
    activeRoot: () => activeRoot(),
  });

  // PAGE-side terminal writers per session, captured when the panel attaches.
  // Used by `runTerminalSequence` to echo `$ <line>` for boot sequences (the
  // owner pty does not echo the programmatic line).
  const terminalWriters = new Map<string, (chunk: string, stream?: 'stdout' | 'stderr') => void>();

  const hiddenSessionIds = new Set<string>();
  const visibleSessions = (): TerminalSessionSnapshot[] =>
    manager.sessions().filter((session) => !hiddenSessionIds.has(session.id));
  const [sessions, setSessions] = createSignal<TerminalSessionSnapshot[]>(visibleSessions());
  const [activeSessionId, setActiveSessionId] = createSignal(manager.activeSessionId());
  const [terminalFocusEpoch, setTerminalFocusEpoch] = createSignal(0);
  const [terminalHistory, setTerminalHistory] = createSignal<readonly TerminalHistoryRecord[]>(
    props.terminalPersistence.initialHistory,
  );

  function rememberTerminalHistory(record: TerminalHistoryRecord): void {
    const next = addTerminalHistoryRecord(terminalHistory(), record);
    setTerminalHistory(next);
    void props.terminalPersistence.saveHistory(next);
  }

  // cwd/env + recorded dev command persist as ONE snapshot (reload-restore);
  // the coalescing contract is pinned behaviorally in orchestration/
  // terminal-state-persistence.test.ts.
  const terminalState = createTerminalStatePersistence({
    initialState: props.terminalPersistence.initialState,
    saveState: (state) => props.terminalPersistence.saveState(state),
    sessionState: (id) => manager.snapshot(id),
  });

  function refreshTerminalState(): void {
    // The dev server runs IN the owner now (ADR-0148 co-resident dev server), as
    // an ordinary long-running `manager.runLine` — its session reports `running` natively,
    // no display-only override needed.
    const next = visibleSessions();
    setSessions(next);
    const active = manager.activeSessionId();
    if (next.some((session) => session.id === active)) {
      setActiveSessionId(active);
      return;
    }
    const fallback = next[0];
    if (fallback) {
      manager.select(fallback.id);
      setActiveSessionId(fallback.id);
    }
  }

  function selectSession(id: string): void {
    manager.select(id);
    refreshTerminalState();
  }

  function createSession(title?: string): TerminalSessionSnapshot {
    const session = manager.createSession(title);
    manager.select(session.id);
    refreshTerminalState();
    setTerminalFocusEpoch((epoch) => epoch + 1);
    return session;
  }

  function closeSession(id: string): void {
    const session = manager.snapshot(id);
    if (session.status === 'running') return;
    const visibleBefore = visibleSessions();
    const closingIndex = visibleBefore.findIndex((candidate) => candidate.id === id);
    const fallback =
      closingIndex > 0 ? visibleBefore[closingIndex - 1] : visibleBefore[closingIndex + 1];
    const wasActive = manager.activeSessionId() === id;
    hiddenSessionIds.add(id);
    if (wasActive && fallback) {
      manager.select(fallback.id);
      setTerminalFocusEpoch((epoch) => epoch + 1);
    }
    refreshTerminalState();
  }

  function attachTerminalWriter(
    id: string,
    write: (chunk: string, stream?: 'stdout' | 'stderr') => void,
  ): void {
    manager.attachWriter(id, write);
    // Also held PAGE-side so `runTerminalSequence` can echo `$ <line>` for boot
    // sequences (the owner pty does not echo the programmatic line).
    terminalWriters.set(id, write);
  }

  // Last EXECUTED line per session + its exec-time cwd — the single exec funnel
  // (boot sequences AND user-typed lines) feeds it; when the owner later reports
  // a dev server running in that session, this is the command that started it.
  const lastExecutedLine = new Map<string, TerminalDevCommand>();

  /**
   * Run one terminal line in the owner shell over the pty channel (ADR-0148
   * co-resident dev server): EVERY line — including the dev-server `vite` / `npm run dev` — runs in the
   * owner now (the owner hosts the co-resident dev server).
   */
  function dispatchLine(id: string, line: string, dims?: TerminalRunDimensions): Promise<number> {
    lastExecutedLine.set(id, { line, cwd: manager.snapshot(id).cwd });
    return manager.runLine(id, line, dims);
  }

  async function runTerminalLine(
    id: string,
    line: string,
    dims?: TerminalRunDimensions,
  ): Promise<number | undefined> {
    const startedMs = Date.now();
    const startedAt = new Date(startedMs).toISOString();
    let exitCode: number | undefined;
    const cwd = manager.snapshot(id).cwd;
    const mode = machine.mode() as TerminalHistoryMode;
    const run = dispatchLine(id, line, dims);
    refreshTerminalState();
    try {
      exitCode = await run;
      return exitCode;
    } catch (err) {
      // A rejected run is a real error (e.g. a tokenizer loud-throw: command
      // substitution `$(…)`, `${VAR:-x}`). Surface the directed diagnostic in the
      // terminal, not just the console — a silent non-zero exit reads as broken.
      const message = err instanceof Error ? err.message : String(err);
      terminalWriters.get(id)?.(`${message}\n`, 'stderr');
      console.error(err);
      exitCode = 1;
      return exitCode;
    } finally {
      refreshTerminalState();
      const finishedMs = Date.now();
      if (line.trim().length > 0) {
        rememberTerminalHistory({
          command: line,
          cwd,
          mode,
          sessionId: id,
          startedAt,
          finishedAt: new Date(finishedMs).toISOString(),
          durationMs: finishedMs - startedMs,
          exitCode,
        });
        terminalState.persistTerminalState(id);
      }
    }
  }

  async function runTerminalSequence(
    id: string,
    lines: readonly string[],
    dims?: TerminalRunDimensions,
  ): Promise<void> {
    // Page-level loop (not manager.runSequence) so a dev-server line in the boot
    // sequence is intercepted by `dispatchLine` like an interactively-typed one.
    refreshTerminalState();
    try {
      const write = terminalWriters.get(id);
      for (const line of lines) {
        write?.(`$ ${line}\n`, 'stdout');
        const exitCode = await dispatchLine(id, line, dims);
        if (exitCode !== 0) break;
      }
    } catch (err) {
      console.error(err);
    } finally {
      refreshTerminalState();
    }
  }

  function stopSession(id: string): void {
    // Every command — including the dev server — runs in the owner now (ADR-0148
    // co-resident dev server); forward the cooperative SIGINT (Ctrl-C aborts the in-flight run).
    manager.stop(id);
    refreshTerminalState();
  }

  function writeTerminalStdin(id: string, data: TerminalRawInput): void {
    manager.writeStdin(id, data);
  }

  // Worker project's node_modules presence (ADR-0080): snapshot excludes its
  // contents but flags presence, gating the lazy row.
  const [nodeModulesPresent, setNodeModulesPresent] = createSignal(false);

  // ADR-0146 owner-resident shell + ADR-0148 co-resident dev server: the snapshot
  // + node_modules bridges are served by
  // the PERSISTENT workspace owner (which now also runs the dev server), so the
  // explorer reflects the owner tree (where `npm install` lands) before AND after
  // any vite run. Subscribed once at setup (no signal dependency), torn on unmount.
  createEffect(() => {
    const unsubscribe = subscribeVfsSnapshot(workspaceOwner().snapshotPort, (frame) => {
      snapshotFs.update(frame);
      setNodeModulesPresent(frame.nodeModulesPresent);
    });
    // Readiness handshake (ADR-0146 owner republishes its snapshot): ask the owner to publish now — covers
    // the case where the owner came up before this subscription (its startup
    // publish would have been missed), replacing the owner-side retry-storm.
    requestVfsSnapshot(workspaceOwner().snapshotPort);
    onCleanup(unsubscribe);
  });

  // (Re)bind the owner-backed SCM core (git-status feed + branch/history reads
  // + actions, ADR-0185) to the LIVE owner: an owner respawn (switch) re-runs
  // this like every other bridge effect. Keyed on the owner signal alone —
  // attachOwner untracks its own body (ADR-0197 §1).
  createEffect(() => {
    scm.attachOwner(workspaceOwner());
  });
  onCleanup(() => scm.dispose());

  // Lazy node_modules read bridge + cache (ADR-0080), against the persistent
  // owner. Available for the whole session (the owner serves it on `serve:true`).
  const [nmCache, setNmCache] = createSignal<NodeModulesCache | null>(null);
  createEffect(() => {
    const cache = new NodeModulesCache(bridgeNodeModulesReads(workspaceOwner().snapshotPort));
    setNmCache(cache);
    onCleanup(() => {
      cache.dispose();
      setNmCache(null);
    });
  });

  // Aggregated TS diagnostics per open file (ADR-0166 P1.9b), keyed by absolute
  // VFS path. Feeds the editor squiggles (per-file `setMarkers`) AND the Problems
  // panel (flattened across files). A new Map per update so solid sees a change.
  const [diagnostics, setDiagnostics] = createSignal<ReadonlyMap<string, readonly Diagnostic[]>>(
    new Map(),
  );

  // TS language service wiring (ADR-0166 P1.9b): once the editor registers its api
  // AND the owner is available, create the id-correlated LS client over the
  // page↔owner↔LS relay, init the project root, and bridge editor document
  // events → `ts:open`/`ts:update`/`ts:close` (debounced) → diagnostics →
  // `setMarkers` + the aggregated signal. The LS is JS/TS-only (Monaco's builtin
  // TS diagnostics are disabled in EditorHost so rifty is the single source).
  createEffect(() => {
    const maybeApi = editorApiSig();
    if (!maybeApi) return;
    const api: EditorApi = maybeApi;
    // ADR-0165 §3: read the owner reactively so a SWITCH (owner respawn) re-binds
    // the LS to the NEW owner + re-inits against the switched-in root — the prior
    // client is disposed in onCleanup before the new one is built.
    const owner = workspaceOwner();
    // The unavailable-owner stub's sendTsLsp/onTsLsp are no-ops → init/requests
    // time out and reject; we swallow (no owner = no diagnostics, surfaced loud
    // in the terminal already). A real owner serves the LS child.
    const client = createTsLanguageServiceClient(owner);
    let disposed = false;
    let ready: Promise<boolean> = Promise.resolve(false);
    const waitForTsRequestGate = async (): Promise<void> => {
      await owner.ready;
      await presetBoot.tsTransitionReady();
    };
    const waitForTsReady = async (): Promise<void> => {
      await waitForTsRequestGate();
      await ready;
    };
    // Register the rifty-LS Monaco providers (ADR-0166 phase 2): hover / def /
    // type-def / completions now come from the REAL service over the relay, not
    // Monaco's isolated lib.d.ts worker (whose hover/completion/goto are turned
    // OFF in EditorHost). Same lifetime as the client — disposed on cleanup.
    const providers = registerTsLanguageServiceProviders(client, api, {
      beforeRequest: waitForTsReady,
    });

    async function initAndReplay(root = activeRoot(), spec = activeTemplate()): Promise<boolean> {
      const run = (async (): Promise<boolean> => {
        await waitForTsRequestGate();
        if (disposed) return false;
        await client.init(root);
        setDiagnostics((prev) => clearTsLsInitDiagnostics(new Map(prev)));
        const replayEvents: EditorDocumentEvent[] = [];
        const unsubscribeReplay = api.onDocument((ev) => {
          if (ev.kind !== 'close') replayEvents.push(ev);
        });
        unsubscribeReplay();
        await Promise.all(replayEvents.map((ev) => client.open(ev.path, ev.text)));
        await diagnosticSync.refreshOpenDiagnostics();
        return true;
      })().catch((err: unknown) => {
        if (!disposed) {
          const message = (err as Error).message;
          setDiagnostics((prev) => {
            const next = new Map(prev);
            if (!shouldPublishTsLsInitDiagnostic(spec, message)) {
              return clearTsLsInitDiagnostics(next);
            }
            return upsertTsLsInitDiagnostic(next, root, message);
          });
          console.warn('[ts-lsp] init', message);
        }
        return false;
      });
      ready = run;
      return run;
    }

    // E2E-only window hooks (ADR-0166 phase 2) — DEV-only (`import.meta.env.DEV`,
    // mirroring the EditorHost `__riftyTs*` hooks): drive the EXACT registered
    // providers (no flaky hover-widget / suggest-dropdown rendering). Each builds
    // a Monaco model+position from a VFS path + 1-based coords and calls the
    // registered provider function, then serializes the result for assertions.
    // Returns null when no model is open for the path (provider can't run yet).
    if (import.meta.env.DEV) {
      const NEVER_CANCEL: monaco.CancellationToken = {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose() {} }),
      };
      const modelFor = (path: string): monaco.editor.ITextModel | null => {
        const uri = api.ensureModel(path);
        return uri ? monaco.editor.getModel(uri) : null;
      };
      const pos = (line: number, column: number): monaco.Position =>
        new monaco.Position(line, column);
      const g = globalThis as unknown as {
        __riftyTsHover?: (path: string, line: number, col: number) => Promise<string | null>;
        __riftyTsDefinition?: (
          path: string,
          line: number,
          col: number,
        ) => Promise<{ uri: string; line: number; column: number }[] | null>;
        __riftyTsCompletions?: (
          path: string,
          line: number,
          col: number,
        ) => Promise<string[] | null>;
        __riftyTsCompletionItems?: (
          path: string,
          line: number,
          col: number,
        ) => Promise<
          | {
              label: string;
              insertText: string;
              startLine: number;
              startColumn: number;
              endLine: number;
              endColumn: number;
              insertTextRules?: number;
              commitCharacters: string[];
              additionalTextEditCount: number;
            }[]
          | null
        >;
        __riftyTsReferences?: (
          path: string,
          line: number,
          col: number,
          includeDeclaration: boolean,
        ) => Promise<{ uri: string; line: number; column: number }[] | null>;
        __riftyTsPrepareRename?: (
          path: string,
          line: number,
          col: number,
        ) => Promise<
          { text: string; line: number; column: number } | { rejectReason: string } | null
        >;
        __riftyTsRenameEdits?: (
          path: string,
          line: number,
          col: number,
          newName: string,
        ) => Promise<{ uri: string; text: string; line: number; column: number }[] | null>;
        __riftyTsSignatureHelp?: (
          path: string,
          line: number,
          col: number,
        ) => Promise<{ label: string; activeSignature: number; activeParameter: number } | null>;
        __riftyTsCodeFixes?: (
          path: string,
          startLine: number,
          startCol: number,
          endLine: number,
          endCol: number,
        ) => Promise<
          {
            title: string;
            kind?: string;
            edits: { uri: string; text: string }[];
          }[]
        >;
        __riftyTsOrganizeImports?: (path: string) => Promise<{
          title: string;
          kind?: string;
          edits: { uri: string; text: string }[];
        } | null>;
        __riftyTsFormat?: (path: string) => Promise<{ editCount: number; applied: string } | null>;
        __riftyTsRangeSemanticTokenCount?: (
          path: string,
          startLine: number,
          startCol: number,
          endLine: number,
          endCol: number,
        ) => Promise<number | null>;
        __riftyTsReinit?: () => Promise<boolean>;
      };
      // Re-init the service against the CURRENT owner VFS (ADR-0166: `ts:init` is
      // idempotent and rebuilds with a fresh tsconfig). The e2e writes a project
      // — tsconfig (bundler resolution) + a fake node_modules dep + sibling files
      // — then calls this so the rebuilt service sees them (the boot build used
      // tsc default options before those files existed). Resolves true on a clean
      // rebuild, false on error (e.g. owner unavailable).
      g.__riftyTsReinit = async () => initAndReplay();
      g.__riftyTsHover = async (path, line, col) => {
        const model = modelFor(path);
        if (!model) return null;
        const hover = await providers.providers.hover.provideHover(
          model,
          pos(line, col),
          NEVER_CANCEL,
        );
        if (!hover) return null;
        return hover.contents.map((c) => c.value).join('\n');
      };
      g.__riftyTsDefinition = async (path, line, col) => {
        const model = modelFor(path);
        if (!model) return null;
        const def = await providers.providers.definition.provideDefinition(
          model,
          pos(line, col),
          NEVER_CANCEL,
        );
        if (!def) return null;
        const arr = Array.isArray(def) ? def : [def];
        return arr.map((d) => {
          // Round-trip the target uri back to its VFS path (proves the full
          // Location.uri → model → path resolution, incl. an opened node_modules
          // `.d.ts`). Falls back to the raw uri string if the model is foreign.
          const target = monaco.editor.getModel(d.uri);
          const targetPath = target ? api.pathForModel(target) : undefined;
          return {
            uri: targetPath ?? d.uri.toString(),
            line: d.range.startLineNumber,
            column: d.range.startColumn,
          };
        });
      };
      g.__riftyTsCompletions = async (path, line, col) => {
        const model = modelFor(path);
        if (!model) return null;
        const result = await providers.providers.completion.provideCompletionItems(
          model,
          pos(line, col),
          { triggerKind: 0 } as monaco.languages.CompletionContext,
          NEVER_CANCEL,
        );
        if (!result) return null;
        return result.suggestions.map((s) =>
          typeof s.label === 'string' ? s.label : s.label.label,
        );
      };
      g.__riftyTsCompletionItems = async (path, line, col) => {
        const model = modelFor(path);
        if (!model) return null;
        const result = await providers.providers.completion.provideCompletionItems(
          model,
          pos(line, col),
          { triggerKind: 0 } as monaco.languages.CompletionContext,
          NEVER_CANCEL,
        );
        if (!result) return null;
        const resolve = providers.providers.completion.resolveCompletionItem;
        const out = [];
        for (const suggestion of result.suggestions) {
          const item =
            (resolve ? await resolve(suggestion, NEVER_CANCEL) : suggestion) ?? suggestion;
          const label = typeof item.label === 'string' ? item.label : item.label.label;
          const range =
            'startLineNumber' in item.range
              ? item.range
              : (item.range.insert ?? item.range.replace);
          out.push({
            label,
            insertText: item.insertText,
            startLine: range.startLineNumber,
            startColumn: range.startColumn,
            endLine: range.endLineNumber,
            endColumn: range.endColumn,
            ...(item.insertTextRules !== undefined
              ? { insertTextRules: item.insertTextRules }
              : {}),
            commitCharacters: item.commitCharacters ?? [],
            additionalTextEditCount: item.additionalTextEdits?.length ?? 0,
          });
        }
        return out;
      };
      // Round-trip a provider-returned target Uri back to its VFS path (proves the
      // Location.uri → model → path resolution incl. an opened sibling/dep buffer);
      // falls back to the raw uri string for a foreign model.
      const pathForUri = (uri: monaco.Uri): string => {
        const target = monaco.editor.getModel(uri);
        const targetPath = target ? api.pathForModel(target) : undefined;
        return targetPath ?? uri.toString();
      };
      g.__riftyTsReferences = async (path, line, col, includeDeclaration) => {
        const model = modelFor(path);
        if (!model) return null;
        const refs = await providers.providers.reference.provideReferences(
          model,
          pos(line, col),
          { includeDeclaration },
          NEVER_CANCEL,
        );
        if (!refs) return null;
        return refs.map((r) => ({
          uri: pathForUri(r.uri),
          line: r.range.startLineNumber,
          column: r.range.startColumn,
        }));
      };
      g.__riftyTsPrepareRename = async (path, line, col) => {
        const model = modelFor(path);
        if (!model) return null;
        const resolve = providers.providers.rename.resolveRenameLocation;
        if (!resolve) return null;
        const result = await resolve(model, pos(line, col), NEVER_CANCEL);
        if (!result) return null;
        if ('rejectReason' in result && result.rejectReason !== undefined) {
          return { rejectReason: result.rejectReason };
        }
        const loc = result as monaco.languages.RenameLocation;
        return { text: loc.text, line: loc.range.startLineNumber, column: loc.range.startColumn };
      };
      g.__riftyTsRenameEdits = async (path, line, col, newName) => {
        const model = modelFor(path);
        if (!model) return null;
        const edit = await providers.providers.rename.provideRenameEdits(
          model,
          pos(line, col),
          newName,
          NEVER_CANCEL,
        );
        if (!edit) return null;
        const out: { uri: string; text: string; line: number; column: number }[] = [];
        for (const e of edit.edits) {
          // Only text edits (the rename provider emits IWorkspaceTextEdit only).
          if (!('textEdit' in e)) continue;
          const te = e as monaco.languages.IWorkspaceTextEdit;
          out.push({
            uri: pathForUri(te.resource),
            text: te.textEdit.text,
            line: te.textEdit.range.startLineNumber,
            column: te.textEdit.range.startColumn,
          });
        }
        return out;
      };
      g.__riftyTsSignatureHelp = async (path, line, col) => {
        const model = modelFor(path);
        if (!model) return null;
        const result = await providers.providers.signatureHelp.provideSignatureHelp(
          model,
          pos(line, col),
          NEVER_CANCEL,
          {
            triggerKind: monaco.languages.SignatureHelpTriggerKind.Invoke,
            isRetrigger: false,
          },
        );
        if (!result) return null;
        const { value } = result;
        const sig = value.signatures[value.activeSignature];
        result.dispose();
        if (!sig) return null;
        return {
          label: sig.label,
          activeSignature: value.activeSignature,
          activeParameter: value.activeParameter,
        };
      };
      // Flatten a Monaco CodeAction's WorkspaceEdit into {uri, text} pairs (uri
      // round-tripped to its VFS path) for assertions. Only text edits.
      const codeActionEdits = (
        action: monaco.languages.CodeAction,
      ): { uri: string; text: string }[] => {
        const out: { uri: string; text: string }[] = [];
        for (const e of action.edit?.edits ?? []) {
          if (!('textEdit' in e)) continue;
          const te = e as monaco.languages.IWorkspaceTextEdit;
          out.push({ uri: pathForUri(te.resource), text: te.textEdit.text });
        }
        return out;
      };
      const resolveCodeAction = async (
        action: monaco.languages.CodeAction,
      ): Promise<monaco.languages.CodeAction> =>
        (await providers.providers.codeAction.resolveCodeAction?.(action, NEVER_CANCEL)) ?? action;
      // Drive the registered code-action provider over a 1-based Monaco range
      // (sources errorCodes from the rifty markers internally). Returns each
      // action's title/kind + flattened edits — proves quick-fixes carry a real edit.
      g.__riftyTsCodeFixes = async (path, startLine, startCol, endLine, endCol) => {
        const model = modelFor(path);
        if (!model) return [];
        const range = new monaco.Range(startLine, startCol, endLine, endCol);
        const list = await providers.providers.codeAction.provideCodeActions(
          model,
          range,
          { markers: [], trigger: monaco.languages.CodeActionTriggerType.Invoke },
          NEVER_CANCEL,
        );
        if (!list) return [];
        const actions = await Promise.all(
          list.actions.map(async (a) => {
            const resolved = await resolveCodeAction(a);
            return {
              title: resolved.title,
              ...(resolved.kind !== undefined ? { kind: resolved.kind } : {}),
              edits: codeActionEdits(resolved),
            };
          }),
        );
        list.dispose();
        return actions;
      };
      // Drive the registered code-action provider for the organize-imports source
      // action only (filtered by kind). Returns it (title/kind + edits) or null.
      g.__riftyTsOrganizeImports = async (path) => {
        const model = modelFor(path);
        if (!model) return null;
        const list = await providers.providers.codeAction.provideCodeActions(
          model,
          model.getFullModelRange(),
          { markers: [], trigger: monaco.languages.CodeActionTriggerType.Invoke },
          NEVER_CANCEL,
        );
        if (!list) return null;
        const organize = list.actions.find((a) => a.kind === 'source.organizeImports');
        const resolved = organize ? await resolveCodeAction(organize) : undefined;
        const result = resolved
          ? {
              title: resolved.title,
              ...(resolved.kind !== undefined ? { kind: resolved.kind } : {}),
              edits: codeActionEdits(resolved),
            }
          : null;
        list.dispose();
        return result;
      };
      // Drive the registered whole-document formatting provider with the model's
      // own indent options. tsserver returns SPAN edits (small inserts/replaces),
      // not a whole-doc replace, so apply them to a scratch model to return the
      // resulting formatted text (deterministic to assert on) + the edit count.
      g.__riftyTsFormat = async (path) => {
        const model = modelFor(path);
        if (!model) return null;
        const opts = model.getOptions();
        const edits = await providers.providers.documentFormatting.provideDocumentFormattingEdits(
          model,
          { tabSize: opts.tabSize, insertSpaces: opts.insertSpaces },
          NEVER_CANCEL,
        );
        if (!edits) return null;
        const scratch = monaco.editor.createModel(model.getValue(), model.getLanguageId());
        try {
          scratch.applyEdits(edits.map((e) => ({ range: e.range, text: e.text })));
          return { editCount: edits.length, applied: scratch.getValue() };
        } finally {
          scratch.dispose();
        }
      };
      g.__riftyTsRangeSemanticTokenCount = async (path, startLine, startCol, endLine, endCol) => {
        const model = modelFor(path);
        if (!model) return null;
        const result =
          await providers.providers.rangeSemanticTokens.provideDocumentRangeSemanticTokens(
            model,
            new monaco.Range(startLine, startCol, endLine, endCol),
            NEVER_CANCEL,
          );
        return result ? result.data.length : null;
      };
    }

    const diagnosticSync = createTsDiagnosticsSync<Diagnostic, monaco.editor.IMarkerData>({
      client,
      debounceMs: 300,
      isSupportedPath: (path) => /\.(ts|tsx|js|jsx|cjs|mjs)$/.test(path),
      setMarkers: (path, markers) => api.setMarkers(path, [...markers]),
      setDiagnostics: (updater) => setDiagnostics((prev) => updater(new Map(prev))),
      toMarkers: lspToMonacoMarkers,
      beforeRequest: waitForTsRequestGate,
      warn: (message) => console.warn('[ts-lsp]', message),
    });
    const unsubscribe = api.onDocument(diagnosticSync.handleDocument);

    // Init against the ACTIVE project root (ADR-0165 §4: /scratch or /projects/<id>).
    // Starter picks rewrite tsconfig/declaration files under the SAME owner/root,
    // so re-run `ts:init` + replay open docs without disposing the providers that
    // the user's in-flight editor command may be calling.
    createEffect(() => {
      tsProjectRevision();
      const root = activeRoot();
      const spec = activeTemplate();
      void initAndReplay(root, spec);
    });

    onCleanup(() => {
      disposed = true;
      diagnosticSync.dispose();
      unsubscribe();
      providers.dispose();
      client.dispose();
      if (import.meta.env.DEV) {
        const g = globalThis as unknown as Record<string, unknown>;
        g.__riftyTsHover = undefined;
        g.__riftyTsDefinition = undefined;
        g.__riftyTsCompletions = undefined;
        g.__riftyTsCompletionItems = undefined;
        g.__riftyTsReferences = undefined;
        g.__riftyTsPrepareRename = undefined;
        g.__riftyTsRenameEdits = undefined;
        g.__riftyTsSignatureHelp = undefined;
        g.__riftyTsCodeFixes = undefined;
        g.__riftyTsOrganizeImports = undefined;
        g.__riftyTsFormat = undefined;
        g.__riftyTsRangeSemanticTokenCount = undefined;
        g.__riftyTsReinit = undefined;
      }
    });
  });

  // (Re)bind the index mirror + boot decision to the LIVE owner (ADR-0165 §3):
  // an owner respawn (switch) re-runs this like every other bridge effect. Keyed
  // on the owner signal alone — attachOwner untracks its own body (ADR-0197 §1).
  createEffect(() => {
    indexBoot.attachOwner(bridgeProjectIndex(workspaceOwner().snapshotPort));
  });
  onCleanup(() => indexBoot.dispose());

  // Auto-dismiss the store toast (ADR-0165 §9). The page `flashToast` self-clears,
  // but the store toast otherwise LINGERS FOREVER — and at top-right (z-index 1000)
  // it sits over the launcher's close button, blocking it. A delete-Undo toast
  // persists for the grace window so Undo stays clickable; the rest clear after a
  // short beat. Re-runs on each new toast (onCleanup cancels the prior timer).
  createEffect(() => {
    const t = store.toast();
    if (!t) return;
    const timer = setTimeout(() => store.setToast(null), t.undo ? DELETE_GRACE_MS : 2500);
    onCleanup(() => clearTimeout(timer));
  });

  // Glyph/label/port for a starter id, derived from the preset registry (ADR-0165
  // §9 launcher cards + chip tile + status bar). No display Starter is stored —
  // the gallery-display fields live on `Preset` (Cross-Phase Reconciliation A).
  function glyphFor(starter: string): {
    text: string;
    color: string;
    label: string;
    port: number;
  } {
    const preset = presetForId(starter);
    const tpl = preset.templateId ? resolveProjectSpec(preset.templateId) : defaultProjectSpec();
    return {
      text: preset.glyph?.text ?? preset.label.slice(0, 1).toUpperCase(),
      color: preset.glyph?.color ?? 'rgba(255,255,255,0.7)',
      label: preset.label,
      port: tpl.defaultPort,
    };
  }
  // Active project's display name + glyph + starter label for the chip + status bar.
  const activeGlyph = createMemo(() => glyphFor(activeStarterId()));
  const activeName = createMemo((): string => {
    const id = store.activeId();
    if (id === 'scratch') {
      return store.scratch() ? scratchDisplayName(activeGlyph().label) : 'Choose project';
    }
    return store.projects().find((p) => p.id === id)?.name ?? `Missing project (${id})`;
  });

  /** Prop bundle for the real-vite explorer's lazy node_modules branch. */
  const nodeModulesProp = ():
    | { cache: NodeModulesCache; present: boolean; root: string }
    | undefined => {
    const cache = nmCache();
    return cache ? { cache, present: nodeModulesPresent(), root: activeRoot() } : undefined;
  };
  /** Async node_modules file reader for the editor (real-vite only). */
  const readNodeModulesFile = ():
    | ((path: string) => Promise<{ size: number; content: Uint8Array | null }>)
    | undefined => {
    const cache = nmCache();
    return cache ? (path: string) => cache.readFile(path) : undefined;
  };

  // SSoT (ADR-0148 co-resident dev server): explorer + editor ALWAYS read the
  // OWNER snapshot (the one
  // source of truth) — no `vite`-gated swap. Editor edits write to the owner; the
  // sync snapshot holds project-file content, the async read-port covers the rest.

  function presetForId(id: string): Preset {
    return PRESETS.find((preset) => preset.id === id) ?? DEFAULT_PRESET;
  }

  const activeInitialEditorFiles = createMemo(() =>
    initialEditorFilesForPreset(presetForId(activeStarterId()), activeRoot()),
  );
  const [publishedInitialEditorFiles, setPublishedInitialEditorFiles] = createSignal<
    readonly string[]
  >(activeInitialEditorFiles());

  function resetEditorToActiveInitialFiles(): void {
    const paths = activeInitialEditorFiles();
    setPublishedInitialEditorFiles(paths);
    editorApi?.openInitialFiles(paths);
  }

  function starterSnapshotEntries(preset: Preset, root: string): VfsSnapshotEntry[] {
    const dirs = new Set<string>();
    const files = Object.entries(seedFilesForStarter(starterById(preset.id), root)).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    for (const [path] of files) {
      let slash = path.lastIndexOf('/');
      while (slash > root.length) {
        const dir = path.slice(0, slash);
        dirs.add(dir);
        slash = dir.lastIndexOf('/');
      }
    }
    return [
      ...[...dirs].sort().map((path) => ({ path, kind: 'dir' as const, size: 0 })),
      ...files.map(([path, content]) => {
        const data = ownerWriteEnc.encode(content);
        return { path, kind: 'file' as const, size: data.byteLength, content: data };
      }),
    ];
  }

  function paintPickedStarterSnapshot(preset: Preset): void {
    snapshotFs.update({
      type: 'snapshot',
      root: activeRoot(),
      entries: starterSnapshotEntries(preset, activeRoot()),
      nodeModulesPresent: false,
    });
  }

  function reinitializeTsForPickedPreset(): void {
    setTsProjectRevision((revision) => revision + 1);
  }

  async function loadPresetUi(preset: Preset): Promise<void> {
    setActivePreset(preset.id);
    await machine.loadPreset(preset);
    paintPickedStarterSnapshot(preset);
    resetEditorToActiveInitialFiles();
  }

  async function paintPickedStarterUi(preset: Preset): Promise<void> {
    await loadPresetUi(preset);
  }

  onMount(() => {
    // Boot policy (ADR-0165 project-first + preset deep-link) — decided in the
    // index-boot core; the degraded fallback-beat timer is cancelled on unmount.
    onCleanup(indexBoot.startBootPolicy(deepLinkStarterId));
  });

  onCleanup(() => {
    if (toastTimer) clearTimeout(toastTimer);
    void flushPendingEditorWrites();
    manager.dispose();
    workspaceOwner().close(); // terminate the persistent owner worker (ADR-0146)
  });

  // ─── Launcher + dialog wiring (ADR-0165 §9) ──────────────────────────────────
  // Save/Rename dialog input text, held page-side (the dialog is controlled).
  const [saveName, setSaveName] = createSignal('');
  const [renameName, setRenameName] = createSignal('');
  // Save/switch decisions (ADR-0165 §7/§9: save phase tracking, plain-Save
  // auto-switch, Save/Discard-then-continue resume, launcher-switch gates) live
  // in the save-flow core; the App binds the real store/lifecycle/index ports.
  const saveFlow = createSaveFlow({
    store,
    workspace,
    pickStarterUnguarded: (starter) =>
      presetBoot.pickStarter(starter, {
        commit: (s) => store.confirmPickStarter(s),
        guardDirtyScratch: false,
        eagerTsGate: true,
      }),
    ownerRoot: () => workspaceOwner().root,
    rootForId,
    activeStarterId,
    // crypto.randomUUID with a Math.random fallback — the page realm owns the
    // entropy source; the core only declares the port (ADR-0197 §3).
    createProjectId: () =>
      `p-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)}`,
    ephemeral: () => saveAffordance(storageMode).ephemeral,
    // Read the port at fire time (the live channel); memory mode never posts.
    saveIndexPhases: (id, name, starter) =>
      saveProjectIndexPhases(workspaceOwner().snapshotPort, id, name, starter),
    openSaveDialog,
    showSaveError: (message) => store.setToast({ kind: 'error', text: message }),
    showEphemeralSaveNotice: (name) =>
      store.setToast({ kind: 'info', text: `${name} · EPHEMERAL (session only)` }),
  });
  // Reset/rename confirms (ADR-0165 §6: real on-disk re-seed + live refresh of
  // the active root) live in the reset-refresh core; the App binds the real ports.
  const resetRefresh = createResetRefresh({
    store,
    devServer,
    ownerUnavailable: () => workspaceOwner().snapshotPort === UNAVAILABLE_OWNER_PORT,
    subscribeSnapshot: (cb) => snapshotFs.subscribe(cb),
    requestSnapshot: () => requestVfsSnapshot(workspaceOwner().snapshotPort),
    resetEditorInitialFiles: () => resetEditorToActiveInitialFiles(),
    flushEditorWrites: () => flushPendingEditorWrites(),
    ephemeral: () => saveAffordance(storageMode).ephemeral,
    activeStarterId,
    // Owner index posts read the port at fire time (the live channel).
    resetScratchIndex: (starter) => resetScratchIndex(workspaceOwner().snapshotPort, starter),
    resetProjectIndex: (id) => resetProjectIndex(workspaceOwner().snapshotPort, id),
    renameProjectIndex: (id, name) => renameProjectIndex(workspaceOwner().snapshotPort, id, name),
  });

  async function flushPendingEditorWrites(): Promise<void> {
    await editorApi?.flushPendingWrites();
  }

  async function selectSidebarView(view: 'explorer' | 'scm'): Promise<void> {
    const willShow = layout.view() !== view || layout.sidebarCollapsed();
    if (view === 'scm' && willShow) {
      await flushPendingEditorWrites();
      scm.requestActiveGitStatus();
    }
    layout.selectView(view);
  }

  // Establish a fresh scratch from a starter in the OWNER index (ADR-0165 §6): the
  // page-mirror flip is immediate UX; this re-creates the durable scratch entry +
  // re-seeds /scratch so the NEXT Save's `saveScratchAsProject` precondition holds
  // (after a prior Save the owner index is `scratch:null`). Read the port at fire
  // time; skipped in memory mode (no durable index). The owner is not respawned on
  // a pick — it stays rooted at /scratch and re-seeds the live tree.
  async function durableNewScratch(
    id: string,
    opts: { readonly preserveDirtySameStarter?: boolean } = {},
  ): Promise<void> {
    if (!saveAffordance(storageMode).ephemeral) {
      await newScratchIndex(workspaceOwner().snapshotPort, id, opts).catch((err: unknown) =>
        console.error('[project-index] new scratch failed', err),
      );
    }
  }

  // Pick a Starter from the launcher (Starters tab). The store prompts on a dirty
  // scratch (switch dialog); a clean pick spins a fresh scratch AND boots the
  // chosen preset through the real worker lifecycle (the gallery pick = boot).
  async function onPickStarter(id: string): Promise<void> {
    if (!(await saveFlow.beginStarterPick())) return;
    indexBoot.markBootDecisionMade();
    // The pick flow (paint → owner → stop-before-write → scratch → seed → boot)
    // lives in the preset-boot core; the store's dirty-guarded pickStarter is the
    // commit — a dirty scratch opens the switch dialog and the boot aborts there.
    await presetBoot.pickStarter(id, {
      commit: (starter) => store.pickStarter(starter),
      guardDirtyScratch: true,
      preserveDirtySameStarter: true,
    });
  }

  // Switch active root from the launcher/chip — the save-flow core gates it over
  // in-flight saves/switches; an applied switch drives the real owner respawn.
  function onLauncherSwitch(id: ActiveId): void {
    void saveFlow.launcherSwitch(id);
  }

  // Open the launcher on the REMEMBERED tab (localStorage), but force STARTERS when
  // there are no saved projects yet — nothing to switch to, only a starter to pick
  // (ADR-0165 §9). Tab changes persist via the launcher's onTab (below).
  function openLauncherAtRememberedTab(): void {
    const tab = initialLauncherTab(
      store.projects().length,
      loadLauncherTab(globalThis.localStorage),
    );
    store.setLauncherTab(tab);
    store.openLauncher();
  }

  // Translate a Projects-tab row action into the matching dialog (ADR-0165 §9).
  function onMenuAction(id: string, action: RowAction): void {
    const proj = store.projects().find((p) => p.id === id);
    if (action === 'switch') {
      onLauncherSwitch(id);
      return;
    }
    if (action === 'rename') {
      setRenameName(proj?.name ?? '');
      store.openDialog({ kind: 'rename', id, current: proj?.name ?? '' });
      return;
    }
    if (action === 'reset') {
      store.openDialog({ kind: 'reset', id });
      return;
    }
    store.openDialog({ kind: 'delete', id });
  }

  // The styled reset-sandbox dialog is the confirm gate (ADR-0165 §9); this runs on
  // its confirm. Closing the owner first releases its OPFS sync-access handles so the
  // clear does not race an open handle.
  async function onResetBrowserSandbox(): Promise<void> {
    store.setDialog(null);
    try {
      manager.dispose();
    } catch {
      /* reload follows; best-effort cleanup */
    }
    try {
      const owner = workspaceOwner();
      owner.close();
      await Promise.race([
        owner.closed.catch(() => 0),
        new Promise((resolve) => setTimeout(resolve, 750)),
      ]);
    } catch {
      /* reload follows; best-effort cleanup */
    }
    const result = await resetBrowserSandboxState();
    if (result.failed.length > 0) {
      // Honest-loud (fidelity): the destructive action did NOT fully clear. Say so
      // BEFORE reload swallows any toast, so the user knows state survived and can retry
      // — never a silent success over persisted state the owner will re-hydrate.
      console.error('[sandbox-reset] partial failure', result.failed);
      globalThis.alert?.(
        `Some sandbox state could not be cleared: ${result.failed
          .map((f) => f.name)
          .join(', ')}. Reloading anyway — you may need to retry the reset.`,
      );
    }
    globalThis.location?.reload();
  }

  // Open the Save-as-project dialog for the active scratch (ProjectsTab save CTA).
  function openSaveDialog(): void {
    setSaveName('');
    store.openDialog({ kind: 'save', defaultName: '' });
  }

  // Dialog-derived strings (ADR-0165 §9 ProjectDialogs contract).
  const dialogStarterLabel = createMemo((): string => {
    const d = store.dialog();
    if (d?.kind !== 'reset') return '';
    const starter =
      d.id === 'scratch'
        ? (store.scratch()?.starter ?? activePreset())
        : (store.projects().find((p) => p.id === d.id)?.starter ?? activePreset());
    return glyphFor(starter).label;
  });
  const dialogTargetName = createMemo((): string => {
    const d = store.dialog();
    if (!d) return '';
    if (d.kind === 'reset') {
      return d.id === 'scratch'
        ? scratchDisplayName(dialogStarterLabel())
        : (store.projects().find((p) => p.id === d.id)?.name ?? '');
    }
    if (d.kind === 'delete') return store.projects().find((p) => p.id === d.id)?.name ?? '';
    return '';
  });
  const dialogSwitchDest = createMemo((): string => {
    const d = store.dialog();
    if (d?.kind !== 'switch') return '';
    if (d.pendingStarter) return `a new ${glyphFor(d.pendingStarter).label} scratch`;
    if (d.pendingId) return store.projects().find((p) => p.id === d.pendingId)?.name ?? '';
    return '';
  });

  // A port is previewable iff it is a registered preview port (ADR-0155 multi-port:
  // the dev-server port is itself a registry entry when running, and each node
  // server's port is added on listen). Membership-only — a non-registered port
  // never yields a URL — while still un-gating from devServerRunning() so a
  // node-only preview's "open in new tab" no longer silently no-ops (Fidelity).
  const isLivePreviewPort = (port: number): boolean =>
    devServer.previewPorts().some((p) => p.port === port);
  const previewUrl = (port = machine.realVitePort()): string | undefined =>
    isLivePreviewPort(port) ? `/preview/${port}/` : undefined;

  function escapeHtmlAttr(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function openPreviewTab(port = machine.realVitePort()): void {
    const url = previewUrl(port);
    if (!url) return;
    const previewWindow = globalThis.window?.open('', '_blank');
    if (!previewWindow) return;
    previewWindow.document.open();
    previewWindow.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>rifty preview ${port}</title>
    <style>
      html, body, iframe { margin: 0; width: 100%; height: 100%; border: 0; background: #101218; }
    </style>
  </head>
  <body>
    <iframe src="${escapeHtmlAttr(url)}" title="Preview port ${port}"></iframe>
  </body>
</html>`);
    previewWindow.document.close();
  }

  function onTerminalLink(uri: string): void {
    const path = pathFromTerminalFileLink(uri, activeRoot());
    if (path) {
      editorApi?.openFile(path);
      return;
    }
    try {
      const url = new URL(uri);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        globalThis.window?.open(uri, '_blank', 'noopener,noreferrer');
      }
    } catch {
      /* ignore malformed links */
    }
  }

  /** Workspace files for the command palette (sync walk, node_modules skipped). */
  function listWorkspaceFiles(limit = 400): { files: string[]; truncated: boolean } {
    const root = activeRoot();
    const out: string[] = [];
    let truncated = false;
    const tree = snapshotFs;
    const walkDir = (dir: string): void => {
      let children: ReturnType<typeof readChildren>;
      try {
        children = readChildren(tree, dir);
      } catch {
        return;
      }
      for (const child of children) {
        if (out.length >= limit) {
          truncated = true;
          return;
        }
        if (child.name === 'node_modules') continue;
        if (child.kind === 'dir') walkDir(child.path);
        else out.push(child.path);
      }
    };
    walkDir(root);
    return { files: out, truncated };
  }

  function paletteItems(): PaletteItem[] {
    const root = activeRoot();
    const items: PaletteItem[] = [];
    for (const preset of PRESETS) {
      items.push({
        id: `tpl:${preset.id}`,
        section: 'Templates',
        label: preset.label,
        hint: preset.id,
        icon: 'layers',
        // Route through the gallery pick path so the STORE's active starter follows
        // the chosen template (ADR-0165 §4) — keeps activeStarterId/template coherent.
        run: () => onPickStarter(preset.id),
      });
    }
    const workspace = listWorkspaceFiles();
    for (const path of workspace.files) {
      items.push({
        id: `file:${path}`,
        section: 'Files',
        label: path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path,
        icon: 'file',
        run: () => editorApi?.openFile(path),
      });
    }
    if (workspace.truncated) {
      items.push({
        id: 'file:truncated',
        section: 'Files',
        label: `…only the first ${workspace.files.length} files are listed`,
        icon: 'ellipsis',
        run: () => {},
      });
    }
    items.push({
      id: 'act:new-terminal',
      section: 'Commands',
      label: 'New terminal',
      icon: 'terminal',
      run: () => {
        createSession();
      },
    });
    items.push({
      id: 'act:toggle-console',
      section: 'Commands',
      label: layout.consoleCollapsed() ? 'Expand terminal panel' : 'Collapse terminal panel',
      icon: layout.consoleCollapsed() ? 'chevron-up' : 'chevron-down',
      run: () => layout.toggleConsole(),
    });
    items.push({
      id: 'act:toggle-sidebar',
      section: 'Commands',
      label: layout.sidebarCollapsed() ? 'Show files panel' : 'Hide files panel',
      icon: 'folder',
      run: () => layout.toggleSidebar(),
    });
    if (devServer.running()) {
      items.push({
        id: 'act:open-preview',
        section: 'Commands',
        label: 'Open preview in new tab',
        icon: 'external-link',
        run: () => openPreviewTab(),
      });
    }
    const stoppableDevServerSessionId = devServer.stoppableSessionId();
    if (devServer.status() !== 'stopped' && stoppableDevServerSessionId) {
      const sessionId = stoppableDevServerSessionId;
      items.push({
        id: 'act:stop-server',
        section: 'Commands',
        label: 'Stop dev server',
        icon: 'x',
        run: () => stopSession(sessionId),
      });
    }
    items.push({
      id: 'act:share',
      section: 'Commands',
      label: 'Copy share link',
      icon: 'copy',
      run: () => void share(),
    });
    items.push({
      id: 'act:export-workspace',
      section: 'Commands',
      label: 'Download workspace archive',
      hint: workspaceArchiveBlocked()
        ? 'Stop the dev server to archive the editable workspace'
        : undefined,
      icon: 'file-output',
      run: () => void files.downloadArchive(),
    });
    items.push({
      id: 'act:import-workspace',
      section: 'Commands',
      label: 'Import workspace archive',
      hint: workspaceArchiveBlocked()
        ? 'Stop the dev server to import into the editable workspace'
        : undefined,
      icon: 'folder-open',
      run: () => files.chooseArchive(),
    });
    items.push({
      id: 'act:github',
      section: 'Commands',
      label: 'Open GitHub repository',
      icon: 'github',
      run: () =>
        globalThis.window?.open(
          'https://github.com/vanilla-wave/rifty',
          '_blank',
          'noopener,noreferrer',
        ),
    });
    return items;
  }

  // Items snapshot, built once per palette open — not a getter, so typing in
  // the palette doesn't re-walk the VFS on every keystroke.
  const [paletteData, setPaletteData] = createSignal<readonly PaletteItem[]>([]);
  function openPalette(): void {
    setPaletteData(paletteItems());
    setPaletteOpen(true);
  }
  function togglePalette(): void {
    if (paletteOpen()) setPaletteOpen(false);
    else openPalette();
  }

  onMount(() => {
    // Capture phase + physical-key match: Monaco (⌘K chord prefix) and xterm
    // (Ctrl-K) swallow the bubble-phase event, and e.key is layout-dependent
    // (Cyrillic layouts yield 'л').
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) {
        e.preventDefault();
        e.stopPropagation();
        togglePalette();
        return;
      }
      // Cmd/Ctrl+S: kill the browser "Save page" dialog; flush the debounced
      // editor writes and pulse a transient "Saved" ack (edits already persist).
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 's' || e.code === 'KeyS')) {
        e.preventDefault();
        e.stopPropagation();
        void editorApi?.flushPendingWrites();
        flashToast('Saved', 'success');
        return;
      }
      // Cmd/Ctrl+W: close the ACTIVE editor tab, not the browser tab. With no
      // closable editor tab the browser default is left alone (beforeunload then
      // guards an in-memory dirty session).
      if ((e.metaKey || e.ctrlKey) && (e.key === 'w' || e.code === 'KeyW')) {
        if (editorApi?.closeActiveTab()) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      // Escape closes the topmost project overlay (ADR-0165 §9 a11y): a project
      // dialog first (drop any stashed Save-then pending), else the launcher modal.
      // The command palette owns its own Escape, so leave it alone.
      if (e.key === 'Escape' && !paletteOpen()) {
        if (store.dialog()) {
          e.preventDefault();
          saveFlow.cancelPendingAfterSave();
          store.setDialog(null);
        } else if (store.launcherOpen()) {
          e.preventDefault();
          indexBoot.closeLauncher();
        }
      }
    };
    globalThis.window?.addEventListener('keydown', onKey, true);
    onCleanup(() => globalThis.window?.removeEventListener('keydown', onKey, true));

    // Guard a reflexive Cmd+R / tab close from silently nuking in-memory work:
    // prompt ONLY when storage is memory-backed (no reload persistence) AND there
    // are unsaved/just-debounced edits. OPFS persists, so it never prompts.
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (storageMode === 'memory' && store.dirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    globalThis.window?.addEventListener('beforeunload', onBeforeUnload);
    onCleanup(() => globalThis.window?.removeEventListener('beforeunload', onBeforeUnload));
  });

  const livePillLabel = (): string =>
    presetBoot.transitioning()
      ? 'SWITCHING'
      : devServer.status() === 'running'
        ? `LIVE :${machine.realVitePort()}`
        : devServer.status() === 'starting'
          ? 'STARTING'
          : 'STOPPED';

  const modeLabel = (): string =>
    machine.mode() === 'dev'
      ? 'Dev · port 3000'
      : machine.mode() === 'real-vite'
        ? presetBoot.transitioning()
          ? `${activeTemplate().displayName} · switching`
          : devServer.status() === 'running'
            ? `${activeTemplate().displayName} · port ${machine.realVitePort()}`
            : `${activeTemplate().displayName} · ${devServer.status()}`
        : activeTemplate().displayName;

  const terminalModeHint = (): TerminalModeHint => ({
    label: 'Shell',
    detail: `Commands run in ${activeRoot()}; running programs own stdin.`,
  });
  // Mount the preview when the dev server is up/starting OR any node server
  // registered a port (ADR-0155 §3 / ADR-0157 review C1): a `node server.js` with
  // the dev server stopped must still show its preview. Keep the `!== 'stopped'`
  // disjunct so the panel shows during the dev 'starting' window (before the slot lands).
  const hasPreview = (): boolean =>
    devServer.status() !== 'stopped' || devServer.previewPorts().length > 0;
  const isOpfs = storageMode === 'opfs';

  return (
    <div
      class="rf-app"
      data-workspace-owner={workspace.ownerReady() ? 'workspace' : 'chooser'}
      data-project-index={indexBoot.projectIndex() ? 'ready' : 'loading'}
    >
      <Show when={props.boot.swError && !swBannerDismissed()}>
        <div class="rf-banner" role="alert" data-banner="sw-error">
          <span class="rf-banner__msg">{swErrorBannerMessage(props.boot.swError ?? '')}</span>
          <button
            type="button"
            class="rf-btn rf-btn--ghost"
            onClick={() => setSwBannerDismissed(true)}
            data-action="dismiss-sw-banner"
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </div>
      </Show>

      <header class="rf-header rf-card">
        <span class="rf-brand">
          <span class="rf-brand__mark" aria-hidden="true" />
          <strong class="rf-wordmark">rifty</strong>
        </span>

        <ProjectSwitcherChip
          name={activeName()}
          glyph={activeGlyph().text}
          glyphColor={activeGlyph().color}
          dirty={store.dirty()}
          onOpen={openLauncherAtRememberedTab}
        />

        <span
          class="rf-livepill"
          data-state={presetBoot.transitioning() ? 'switching' : devServer.status()}
          title={modeLabel()}
        >
          <span class="rf-livepill__dot" aria-hidden="true" />
          {livePillLabel()}
        </span>

        <span class="rf-spacer" />

        <button type="button" class="rf-cmdbar" data-action="open-palette" onClick={openPalette}>
          <Icon name="search" size={13} />
          <span class="rf-cmdbar__hint">Search or run a command</span>
          <span class="rf-kbd">⌘K</span>
        </button>

        <span class="rf-spacer" />

        <a
          class="rf-iconbtn"
          href="https://github.com/vanilla-wave/rifty"
          target="_blank"
          rel="noopener noreferrer"
          title="rifty on GitHub"
          aria-label="rifty on GitHub"
        >
          <Icon name="github" size={16} />
        </a>
        <button type="button" class="rf-share" data-action="share" onClick={() => void share()}>
          <Icon name="users" size={13} />
          Share
        </button>
      </header>

      <Show when={capabilities.sufficient} fallback={<CapabilitiesPanel check={capabilities} />}>
        <div
          class="rf-shell"
          data-sidebar={layout.sidebarCollapsed() ? 'collapsed' : 'open'}
          style={{
            '--rf-sidebar-w': `${layout.sidebarW()}px`,
            '--rf-console-h': `${layout.consoleH()}px`,
            '--rf-preview-w': `${layout.previewW()}px`,
          }}
        >
          <aside class="rf-sidebar rf-card">
            <div class="rf-sidebar__nav" role="tablist" aria-label="Sidebar views">
              <button
                type="button"
                role="tab"
                class="rf-sidebar__tab"
                aria-selected={layout.view() !== 'scm'}
                onClick={() => void selectSidebarView('explorer')}
              >
                Files
              </button>
              <button
                type="button"
                role="tab"
                class="rf-sidebar__tab"
                aria-selected={layout.view() === 'scm'}
                onClick={() => void selectSidebarView('scm')}
              >
                GIT
              </button>
            </div>
            <Show
              when={layout.view() === 'scm'}
              fallback={
                /* SSoT (ADR-0148 co-resident dev server): the explorer ALWAYS reflects the OWNER snapshot
                   (one source of truth) + the lazy node_modules read-port — no
                   `vite`-gated backing-store swap. */
                <FileExplorer
                  vfs={snapshotFs}
                  mutations={explorerMutations}
                  root={activeRoot()}
                  nodeModules={nodeModulesProp()}
                  visible={!layout.sidebarCollapsed()}
                  activePath={activeFilePath()}
                  gitStatus={scm.gitStatus()}
                  onOpenFile={(path) => editorApi?.openFile(path)}
                  onDownloadFile={(path) => void files.downloadFile(path)}
                  onCompareFiles={(left, right) => void scm.openWorkingFileCompare(left, right)}
                  onCompareWithHead={(path) => void scm.openWorkingHeadCompare(path)}
                  onNotify={(message, tone) => flashToast(message, tone)}
                />
              }
            >
              <ScmPanel
                root={activeRoot()}
                branch={scm.activeScm().branch}
                status={scm.gitStatus()}
                history={scm.activeScm().history}
                onOpenChange={(row) => void scm.openScmResourceDiff(row)}
                onStage={scm.stageRow}
                onUnstage={scm.unstageRow}
                onDiscard={scm.discardRow}
                onCommit={scm.commit}
              />
            </Show>
          </aside>

          <Splitter
            orientation="vertical"
            value={layout.sidebarW()}
            min={layout.bounds.sidebarW[0]}
            max={layout.bounds.sidebarW[1]}
            defaultValue={232}
            dir={1}
            ariaLabel="Resize sidebar"
            onInput={(px) => layout.setSidebarW(px)}
            onCommit={() => layout.persist()}
            onReset={() => layout.resetSidebarW()}
          />

          <main class="rf-main" data-console={layout.consoleCollapsed() ? 'collapsed' : 'open'}>
            <div class="rf-editorarea" data-preview={hasPreview() ? 'on' : 'off'}>
              <Show when={indexBoot.editorProjectContextReady()}>
                <EditorHost
                  initialEditorFiles={publishedInitialEditorFiles}
                  root={activeRoot}
                  vfs={snapshotFs}
                  registerApi={(api) => {
                    editorApi = api;
                    setEditorApiSig(() => api);
                  }}
                  onActive={(info) => {
                    setActiveFile(info.label);
                    setActiveLang(info.language);
                    setActiveFilePath(info.path);
                  }}
                  onFileWritten={(path, content) => files.writeFile(path, content)}
                  readNodeModulesFile={readNodeModulesFile()}
                  readGitOriginalText={scm.readGitOriginalText}
                  gitStatus={scm.gitStatus}
                  previewUrl={previewUrl}
                  onOpenPreviewTab={openPreviewTab}
                  onError={flashError}
                />
              </Show>

              <Show when={hasPreview()}>
                <Splitter
                  orientation="vertical"
                  value={layout.previewW()}
                  min={layout.bounds.previewW[0]}
                  max={layout.bounds.previewW[1]}
                  defaultValue={464}
                  dir={-1}
                  ariaLabel="Resize preview"
                  onInput={(px) => layout.setPreviewW(px)}
                  onCommit={() => layout.persist()}
                  onReset={() => layout.resetPreviewW()}
                />
              </Show>
              {/* Non-keyed (ADR-0157 review C5): one long-lived PreviewPanel that
                  self-reconciles its selection against `ports` — a dev-port change
                  (preset switch) no longer re-mounts and discards the chosen node
                  port. `initialPort` is read once at mount: most-recent live port,
                  else the dev port. */}
              <Show when={hasPreview()}>
                <PreviewPanel
                  initialPort={devServer.previewPorts().at(-1)?.port ?? machine.realVitePort()}
                  onOpenTab={openPreviewTab}
                  onNotify={flashToast}
                  ports={devServer.previewPorts}
                />
              </Show>
            </div>

            <Splitter
              orientation="horizontal"
              value={layout.consoleH()}
              min={layout.bounds.consoleH[0]}
              max={layout.bounds.consoleH[1]}
              defaultValue={280}
              dir={-1}
              ariaLabel="Resize console"
              onInput={(px) => layout.setConsoleH(px)}
              onCommit={() => layout.persist()}
              onReset={() => layout.resetConsoleH()}
            />

            <BottomPanel
              collapsed={layout.consoleCollapsed()}
              sessions={sessions()}
              activeSessionId={activeSessionId()}
              terminalFocusEpoch={terminalFocusEpoch()}
              onToggleCollapse={() => layout.toggleConsole()}
              onSelectSession={selectSession}
              onCreateSession={() => createSession()}
              onCloseSession={closeSession}
              attach={attachTerminalWriter}
              modeHint={terminalModeHint()}
              historyRecords={terminalHistory}
              onLink={onTerminalLink}
              onSignal={stopSession}
              onRawInput={writeTerminalStdin}
              onLine={(id, line, dims) => runTerminalLine(id, line, dims)}
              diagnostics={diagnostics()}
              onOpenProblem={(path, line, column) =>
                editorApi?.openFile(path, { reveal: { line, column } })
              }
            />
          </main>
        </div>

        {/* ADR-0165 §8 degraded banner — honest-loud "persistence off" notice,
            anchored above the status bar. Gated on degradedBannerVisible: memory
            mode, undismissed, launcher closed. Distinct from the fatal COI gate. */}
        <Show
          when={degradedBannerVisible({
            storage: storageMode,
            bannerDismissed: bannerDismissed(),
            launcherOpen: store.launcherOpen(),
          })}
        >
          <DegradedBanner
            onReEnable={() => globalThis.location?.reload()}
            onDismiss={() => setBannerDismissed(true)}
          />
        </Show>

        <StatusBar
          mode={machine.mode()}
          modeLabel={modeLabel()}
          activeFile={activeFile()}
          language={activeLang()}
          isOpfs={isOpfs}
          storageMode={storageMode}
          storagePersisted={
            props.boot.storage.available ? props.boot.storage.persistedAfter : undefined
          }
          storageUsage={props.boot.storage.available ? props.boot.storage.usage : undefined}
          storageQuota={props.boot.storage.available ? props.boot.storage.quota : undefined}
          storageReason={props.boot.storage.error ?? props.boot.vfsBoot.reason}
          coi={isCrossOriginIsolated()}
          activeName={activeName()}
          activeStarter={activeGlyph().label}
          dirty={store.dirty()}
          onExport={() => void files.downloadArchive()}
          exportDisabled={workspaceArchiveBlocked()}
          exportTitle={
            workspaceArchiveBlocked()
              ? 'Stop the dev server to archive the editable workspace'
              : 'Download the editable workspace as a .json archive'
          }
          gitBranch={scm.activeScm().branch}
        />
      </Show>

      {/* ADR-0165 §9: the launcher modal (Starters gallery + Projects tab) and the
          five project dialogs — top-level overlays (siblings of the toast). */}
      <Launcher
        open={store.launcherOpen()}
        tab={store.launcherTab()}
        presets={PRESETS}
        projects={store.projects()}
        scratch={store.scratch()}
        activeId={store.activeId()}
        storage={store.storage()}
        menuFor={store.menuFor()}
        q={store.q()}
        cat={(store.cat() ?? 'all') as 'all' | StarterGroup}
        glyphFor={glyphFor}
        onTab={(tab) => {
          store.setLauncherTab(tab);
          saveLauncherTab(globalThis.localStorage, tab); // remember for next open (§9)
        }}
        onClose={() => indexBoot.closeLauncher()}
        onSearch={(q) => store.setQ(q)}
        onCat={(cat) => store.setCat(cat)}
        onPickStarter={onPickStarter}
        onSwitch={onLauncherSwitch}
        onSave={openSaveDialog}
        onMenu={(id) => store.setMenuFor(id)}
        onMenuAction={onMenuAction}
        onResetSandbox={() => store.openDialog({ kind: 'reset-sandbox' })}
      />

      <ProjectDialogs
        dialog={store.dialog()}
        saveName={saveName()}
        renameName={renameName()}
        targetName={dialogTargetName()}
        starterLabel={dialogStarterLabel()}
        switchDest={dialogSwitchDest()}
        onSaveName={(v) => setSaveName(v)}
        onRenameName={(v) => setRenameName(v)}
        onCancel={() => {
          saveFlow.cancelPendingAfterSave(); // a cancelled Save-then-continue drops its pending switch
          store.setDialog(null);
        }}
        onConfirmSave={() => void saveFlow.confirmSave(saveName())}
        onConfirmRename={() => resetRefresh.confirmRename(renameName())}
        onConfirmReset={resetRefresh.confirmReset}
        onConfirmDelete={() => store.confirmDelete()}
        onConfirmResetSandbox={() => void onResetBrowserSandbox()}
        onSwitchSaveThen={saveFlow.switchSaveThen}
        onSwitchDiscardThen={saveFlow.switchDiscardThen}
      />

      <Show when={toast()} keyed>
        {(t) => (
          <output class="rf-toast" data-tone={t.tone}>
            <Show when={t.tone === 'success'}>
              <span class="rf-toast__ico" aria-hidden="true">
                <Icon name="check" size={14} />
              </span>
            </Show>
            {t.message}
          </output>
        )}
      </Show>

      {/* ADR-0165 §9 store toast: carries the delete-Undo affordance — clicking
          Undo cancels the deferred on-disk delete and restores the project. */}
      <Show when={store.toast()} keyed>
        {(t) => (
          <output class="rf-toast" data-tone={t.kind === 'error' ? 'error' : 'success'}>
            {t.text}
            <Show when={t.undo}>
              <button
                type="button"
                class="rf-toast__undo"
                onClick={() => {
                  store.undoDelete();
                  store.setToast(null);
                }}
              >
                Undo
              </button>
            </Show>
          </output>
        )}
      </Show>

      <CommandPalette
        open={paletteOpen()}
        items={paletteData()}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}
