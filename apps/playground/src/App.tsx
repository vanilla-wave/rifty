import { isSabIpcSupported } from '@riftydev/kernel';
import { detectCapabilities } from '@riftydev/runtime-js/env/capabilities';
import type { TerminalRawInput } from '@riftydev/terminal';
import {
  type TerminalHistoryMode,
  type TerminalHistoryRecord,
  addTerminalHistoryRecord,
} from '@riftydev/terminal/history';
import type { Diagnostic } from '@riftydev/ts-language-service/lsp-types';
import { normalizePath } from '@riftydev/vfs';
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
import { FileExplorer } from './components/FileExplorer.tsx';
import { Launcher } from './components/Launcher.tsx';
import { PreviewPanel } from './components/PreviewPanel.tsx';
import { ProjectDialogs } from './components/ProjectDialogs.tsx';
import { ProjectSwitcherChip } from './components/ProjectSwitcherChip.tsx';
import type { RowAction } from './components/ProjectsTab.tsx';
import { Splitter } from './components/Splitter.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import type { TerminalModeHint } from './components/TerminalPanel.tsx';
import { Icon } from './components/icons.tsx';
import { DELETE_GRACE_MS, createAppProjectStore } from './glue/app-project-store.ts';
import { copyToClipboard } from './glue/clipboard.ts';
import {
  degradedBannerVisible,
  saveAffordance,
  storageModeFromBoot,
} from './glue/degraded-storage.ts';
import { readChildren } from './glue/file-tree.ts';
import { initialLauncherTab, loadLauncherTab, saveLauncherTab } from './glue/launcher-prefs.ts';
import { NodeModulesCache } from './glue/node-modules-cache.ts';
import { bridgeNodeModulesReads } from './glue/node-modules-port.ts';
import { programMirrorPath } from './glue/program-path.ts';
import { scratchDisplayName } from './glue/project-display-name.ts';
import {
  bridgeProjectIndex,
  deleteProjectTree,
  newScratchIndex,
  renameProjectIndex,
  resetProjectIndex,
  resetScratchIndex,
  saveProjectIndexPhases,
  setActiveIndex,
} from './glue/project-index-port.ts';
import { type ActiveId, type ProjectIndex, rootForId } from './glue/project-index.ts';
import type { PreviewPortEntry } from './glue/pty-protocol.ts';
import {
  type WorkspaceOwnerHandle,
  startWorkspaceOwner,
  wirePreviewBridge,
} from './glue/realVite.ts';
import { workspaceVfsPrefix } from './glue/scoped-vfs.ts';
import { SnapshotFs } from './glue/snapshot-fs.ts';
import { type StarterGroup, seedFilesForStarter, starterById } from './glue/starter.ts';
import { requestSwitch } from './glue/switch-owner.ts';
import { pathFromTerminalFileLink } from './glue/terminal-links.ts';
import type { TerminalPersistence } from './glue/terminal-persistence.ts';
import { createTsDiagnosticsSync } from './glue/ts-diagnostics-sync.ts';
import { createTsLanguageServiceClient, lspToMonacoMarkers } from './glue/ts-ls-client.ts';
import {
  clearTsLsInitDiagnostics,
  upsertTsLsInitDiagnostic,
} from './glue/ts-ls-init-diagnostic.ts';
import { registerTsLanguageServiceProviders } from './glue/ts-ls-monaco-providers.ts';
import { requestVfsSnapshot, subscribeVfsSnapshot } from './glue/vfs-snapshot-port.ts';
import { DEFAULT_PRESET, PRESETS, type Preset, presetBootLines } from './presets.ts';
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
    writeFile: () => {},
    exportArchive: () => Promise.reject(new Error(OWNER_UNAVAILABLE_MSG)),
    importArchive: () => Promise.reject(new Error(OWNER_UNAVAILABLE_MSG)),
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

  // PAGE in-memory mirror of the owner's project index (ADR-0165 §3). The OPFS
  // index is worker-writable-only, so the launcher renders the project list from
  // this mirror. The subscribing `createEffect` (which reads `workspaceOwner()`)
  // stays below where the owner exists; only this SIGNAL is hoisted so the store
  // can hydrate from it.
  const [projectIndex, setProjectIndex] = createSignal<ProjectIndex | null>(null);

  // ADR-0165 §57: DIRTY binds to a REAL owner file-write, never a UI counter. The
  // owner handle exposes no write event (writes ORIGINATE on the page —
  // editor/program edits flow out through `writeWorkspaceFile`/`onProgramChange`),
  // so the page IS the write source: a tiny notifier the write paths fire and the
  // store subscribes to. This is the honest signal — a write actually happened.
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
  // delete to the owner tree (§56). The cold-boot default index models the active
  // scratch from DEFAULT_PRESET (so the chip/banner/Save work before the owner
  // publishes); `onDiskDelete` reads `workspaceOwner()` LAZILY at fire-time, so the
  // store can be created here — before the owner is spawned below — with no TDZ hit.
  // §56 durable-delete tracking: ids whose on-disk removal was POSTED but not yet
  // confirmed by an owner re-publish. A delete fired during the owner teardown→
  // respawn gap (switch) reaches no listener and is dropped, so the project would
  // resurrect on the next publish. Re-fired on every owner re-wire (effect below)
  // and cleared once the owner-published index no longer lists the id → eventually
  // consistent, never a silent resurrection.
  const pendingOnDiskDeletes = new Set<string>();

  const store = createAppProjectStore({
    index: projectIndex() ?? {
      activeId: 'scratch',
      scratch: { starter: DEFAULT_PRESET.id, dirty: false, editedAt: 'no edits yet' },
      projects: [],
    },
    storage: storageMode,
    owner: fileWriteOwner,
    // §56: the page-mirror delete + Undo is REAL (launcher updates, restore works).
    // After the grace window the DURABLE removal of `/projects/<id>` posts an
    // `index-delete` to the owner (the OPFS index is worker-writable-only,
    // ADR-0135): the owner rmSyncs the tree, drops it from the index (re-points
    // activeId if it was active), and re-publishes so this mirror reconciles. Read
    // the port at fire time — an owner respawn (switch) moves the live channel.
    // Tracked in `pendingOnDiskDeletes` so a post dropped during an owner respawn
    // is re-fired (the effect below), not silently lost.
    onDiskDelete: (id) => {
      pendingOnDiskDeletes.add(id);
      void deleteProjectTree(workspaceOwner().snapshotPort, id).catch((err: unknown) =>
        console.error('[project-index] delete failed', err),
      );
    },
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

  const [activeFile, setActiveFile] = createSignal('main.js');
  const [activeFilePath, setActiveFilePath] = createSignal<string | undefined>(undefined);
  const [activeLang, setActiveLang] = createSignal('javascript');
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
    return devServerStatus() !== 'stopped';
  }

  async function downloadWorkspaceArchive(): Promise<void> {
    if (workspaceArchiveBlocked()) {
      flashError('Stop the dev server to archive the editable workspace');
      return;
    }
    const doc = globalThis.document;
    if (!doc) {
      flashError('Workspace archive download is unavailable here');
      return;
    }
    try {
      // Single store owner, page holds no authoritative fs: serialize the OWNER
      // tree (the single store), not a page copy — so the archive includes
      // shell/CLI-authored files, full content (no cap).
      const archive = await workspaceOwner().exportArchive();
      const blob = new Blob([archive], { type: 'application/vnd.rifty.workspace+json' });
      const url = URL.createObjectURL(blob);
      const a = doc.createElement('a');
      a.href = url;
      a.download = 'rifty-workspace.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      flashToast('Workspace archive downloaded', 'success');
    } catch (err) {
      flashError(`Archive download failed: ${(err as Error).message}`);
    }
  }

  async function importWorkspaceArchiveFile(file: File): Promise<void> {
    try {
      // Single store owner, page holds no authoritative fs: apply into the OWNER
      // tree, then pull a fresh snapshot so the explorer/editor reflect it (no
      // page store to write).
      await workspaceOwner().importArchive(await file.text());
      requestVfsSnapshot(workspaceOwner().snapshotPort);
      flashToast('Workspace archive imported', 'success');
    } catch (err) {
      flashError(`Import failed: ${(err as Error).message}`);
    }
  }

  function chooseWorkspaceArchive(): void {
    if (workspaceArchiveBlocked()) {
      flashError('Stop the dev server to import into the editable workspace');
      return;
    }
    const doc = globalThis.document;
    if (!doc) {
      flashError('Workspace archive import is unavailable here');
      return;
    }
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json,application/vnd.rifty.workspace+json';
    input.addEventListener(
      'change',
      () => {
        const file = input.files?.[0];
        if (file) void importWorkspaceArchiveFile(file);
      },
      { once: true },
    );
    input.click();
  }

  // Active real-project template (ADR-0078): follows the ACTIVE STARTER (store-
  // derived, ADR-0165 §4), so a node-server project boots ITS worker runtime, not
  // the registry default — and the template stays coherent after a switch. Chip +
  // mode machine read its generic display name.
  const templateForPreset = (preset: Preset): ProjectSpec =>
    preset.templateId ? resolveProjectSpec(preset.templateId) : defaultProjectSpec();

  const activeTemplate = (): ProjectSpec => templateForPreset(presetForId(activeStarterId()));

  // Persistent workspace owner (ADR-0146 owner-resident shell + ADR-0148
  // co-resident dev server): hosts the resident `Shell` per session + cwd/env +
  // the CO-RESIDENT dev server, runs `npm install` + bin/`execSync` + `vite`
  // in-realm against ITS `syncMirror()` — the one store the explorer/editor read
  // over the snapshot/nm bridges. Spawned once at setup, killed on cleanup. Gated
  // on SAB IPC: in the single-store-owner model there is no PAGE shell fallback,
  // so a non-isolated host gets a fail-loud stub owner that surfaces the
  // requirement per command (rather than crashing the app tree at setup).
  // ADR-0165 §3: the owner is torn down + respawned on switch (RIFTY_RFV_ROOT is
  // frozen per spawn). Held in a signal so requestSwitch can swap it; every bridge
  // effect reads `workspaceOwner()` so the signal swap re-runs them — that swap IS
  // the re-wire to the new owner.
  const [ownerHandle, setOwnerHandle] = createSignal<WorkspaceOwnerHandle>(
    isSabIpcSupported()
      ? startWorkspaceOwner({
          // ADR-0165 §4: root + slug follow the STORE's active id (scratch on boot,
          // a projectId after switch); template/setup follow the active STARTER.
          workspaceId,
          root: activeRoot(),
          template: activeTemplate(),
          slug: store.activeId(),
          starter: activeStarterId(),
          setup: presetForId(activeStarterId()).setup,
          onLog: (line) => console.info(line),
        })
      : createUnavailableOwner(),
  );
  const workspaceOwner = (): WorkspaceOwnerHandle => ownerHandle();

  // Mode state machine owns UI state only. Real server lifetime belongs to the
  // visible `vite` terminal command.
  const machine = useMode({
    sources: { dev: DEFAULT_PRESET.source, realVite: DEFAULT_PRESET.source },
  });

  // Dev-server lifecycle is OWNER-driven now (ADR-0148 co-resident dev server):
  // the `vite` / `npm run dev` line runs in the owner over the pty channel; the owner reports
  // start/stop + the listen port via `pty:dev-server` frames. The page only
  // mirrors that state + (un)wires the preview SW route.
  const [devServerStatus, setDevServerStatus] = createSignal<'stopped' | 'starting' | 'running'>(
    'stopped',
  );
  const devServerRunning = (): boolean => devServerStatus() === 'running';
  const [tsProjectRevision, setTsProjectRevision] = createSignal(0);
  interface TsPresetTransitionGate {
    resolve(): void;
  }
  let tsPresetTransitionReady: Promise<void> = Promise.resolve();
  function beginTsPresetTransition(): TsPresetTransitionGate {
    let resolve!: () => void;
    tsPresetTransitionReady = new Promise<void>((done) => {
      resolve = done;
    });
    return { resolve };
  }

  // ALL live previewable ports (ADR-0155): the dev-server port + each `node
  // <file>` server's ports, pushed by the owner as a `pty:preview` snapshot. Feeds
  // the PreviewPanel switcher. The dev-server port's SW bridge is wired by the
  // `onDevServer` path above; this set drives the per-node-port bridges (below).
  const [previewPorts, setPreviewPorts] = createSignal<PreviewPortEntry[]>([]);
  let devServerSessionId: string | null = null;
  let devServerRestartGeneration = 0;

  // Mirror the owner's dev-server state + wire the page-side preview SW route on
  // the reported port (ADR-0148 co-resident dev server). The owner serves `/preview/<port>/`; the
  // page only (un)registers the matching cross-realm bridge on start/stop.
  createEffect(() => {
    let tearPreview: (() => void) | undefined;
    const unsubscribe = workspaceOwner().onDevServer((frame) => {
      const wasRunning = devServerStatus() === 'running';
      setDevServerStatus(frame.status);
      if (frame.status === 'running' && !wasRunning) {
        setTsProjectRevision((revision) => revision + 1);
      }
      if (frame.port !== undefined) machine.setRealVitePort(frame.port);
      tearPreview?.();
      tearPreview =
        frame.status === 'running' && frame.port !== undefined
          ? wirePreviewBridge(frame.port, workspaceOwner().previewOwnerToken)
          : undefined;
    });
    onCleanup(() => {
      tearPreview?.();
      unsubscribe();
    });
  });

  // Mirror the owner's full preview-port set (ADR-0155) + (re)request it on
  // subscribe — recovers a `pty:preview` push that predates this listener (same
  // handshake discipline as the dev-server-req above; never a one-shot push).
  createEffect(() => {
    const unsubscribe = workspaceOwner().onPreview((frame) => setPreviewPorts(frame.ports));
    workspaceOwner().requestPreview();
    onCleanup(unsubscribe);
  });

  // Per-port SW preview bridge for non-dev-server ports (node + vite preview). The dev-server
  // port keeps its existing bridge from the `onDevServer` path above — never
  // double-wire it. Diff the live ports against active teardowns: wire a
  // newly-present port, tear down + drop one that left the set. `onCleanup` tears
  // down all.
  const nodePortBridges = new Map<number, () => void>();
  createEffect(() => {
    // Never wire a node bridge for the ACTIVE dev-server port (ADR-0157 review C3):
    // the `onDevServer` path already owns that `/preview/<port>/` route, so a node
    // server that picked the same port must not register a second (clobbering)
    // bridge whose teardown would delete the shared route.
    const devPort = devServerRunning() ? machine.realVitePort() : null;
    const live = new Set(
      previewPorts()
        .filter((p) => p.source !== 'dev-server' && p.port !== devPort)
        .map((p) => p.port),
    );
    for (const port of live) {
      if (!nodePortBridges.has(port)) {
        nodePortBridges.set(port, wirePreviewBridge(port, workspaceOwner().previewOwnerToken));
      }
    }
    for (const [port, tear] of nodePortBridges) {
      if (!live.has(port)) {
        tear();
        nodePortBridges.delete(port);
      }
    }
  });
  onCleanup(() => {
    for (const tear of nodePortBridges.values()) tear();
    nodePortBridges.clear();
  });

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

  function persistTerminalState(id: string): void {
    const session = manager.snapshot(id);
    void props.terminalPersistence.saveState({ cwd: session.cwd, env: session.env });
  }

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

  /**
   * Run one terminal line in the owner shell over the pty channel (ADR-0148
   * co-resident dev server): EVERY line — including the dev-server `vite` / `npm run dev` — runs in the
   * owner now (the owner hosts the co-resident dev server).
   */
  function dispatchLine(id: string, line: string, dims?: TerminalRunDimensions): Promise<number> {
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
        persistTerminalState(id);
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
      await tsPresetTransitionReady;
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

    async function initAndReplay(root = activeRoot()): Promise<boolean> {
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
          setDiagnostics((prev) => upsertTsLsInitDiagnostic(new Map(prev), root, message));
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
      void initAndReplay(root);
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

  // Subscribe the project-index mirror against the LIVE owner (ADR-0165 §3): the
  // `projectIndex` SIGNAL is hoisted above (the store hydrates from it); this
  // effect reads `workspaceOwner()` so an owner respawn (switch) re-subscribes
  // against the NEW owner; `request()` recovers a pre-listener owner publish.
  // It ALSO re-fires any `pendingOnDiskDeletes` (§56): a delete posted during the
  // previous owner's teardown reached no listener, so re-post it to the new owner
  // (idempotent — an unknown id is a no-op publish) → the project can't resurrect.
  createEffect(() => {
    const owner = workspaceOwner();
    const mirror = bridgeProjectIndex(owner.snapshotPort);
    const unsub = mirror.subscribe(setProjectIndex);
    void mirror.request(); // owner re-publishes (recovers a pre-listener push)
    for (const id of pendingOnDiskDeletes) {
      void deleteProjectTree(owner.snapshotPort, id).catch((err: unknown) =>
        console.error('[project-index] retry delete failed', err),
      );
    }
    onCleanup(() => {
      unsub();
      mirror.dispose();
    });
  });

  // Fold each fresh owner-published index into the store mirror (launcher list
  // survives owner respawns on switch — load-bearing risk #7, ADR-0165 §3). A
  // durable delete is CONFIRMED once the owner-published index no longer lists it
  // → drop it from `pendingOnDiskDeletes` (§56 eventually-consistent delete).
  createEffect(() => {
    const idx = projectIndex();
    if (!idx) return;
    store.hydrateIndex(idx);
    for (const id of pendingOnDiskDeletes) {
      if (!idx.projects.some((p) => p.id === id)) pendingOnDiskDeletes.delete(id);
    }
  });

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
    if (id === 'scratch') return scratchDisplayName(activeGlyph().label);
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
  let initialRunTimer: ReturnType<typeof setTimeout> | undefined;

  function presetForId(id: string): Preset {
    return PRESETS.find((preset) => preset.id === id) ?? DEFAULT_PRESET;
  }

  function workspacePresetPath(path: string): string {
    const normalized = normalizePath(`${activeRoot()}/${path.replace(/^\/+/, '')}`);
    if (normalized === activeRoot() || !normalized.startsWith(`${activeRoot()}/`)) {
      throw new Error(`Preset file escapes workspace: ${path}`);
    }
    return normalized;
  }

  function openPresetEditorTabs(preset: Preset): void {
    for (const path of preset.openFiles ?? []) {
      editorApi?.openFile(workspacePresetPath(path), { activate: false });
    }
  }

  // SSoT (ADR-0148 co-resident dev server; single store owner, page holds no
  // authoritative fs): editor writes flow to the OWNER — the single
  // store the dev server (HMR), shell, and archive export all read. No page copy.
  function writeWorkspaceFile(path: string, content: string): void {
    // The program mirror (active template entry, ADR-0165 §4) flows through
    // onProgramChange (which owns its owner write); skip the double-write here.
    if (path !== programMirrorPath(activeRoot(), activeTemplate())) {
      workspaceOwner().writeFile(path, content);
    }
    notifyFileWritten(path, content); // ADR-0165 §57: REAL write → scratch dirty
  }

  /**
   * Push starter files into the persistent owner realm (ADR-0146
   * owner-resident shell; the owner is the single authoritative store owner and
   * the page holds no authoritative fs). This mirrors the durable owner reset for
   * boot-critical files, but runs synchronously before the dev-server boot line so
   * template files like index.html cannot lag a mid-session starter pick.
   */
  function seedWorkspaceOwner(preset: Preset): void {
    const root = activeRoot();
    const rootPackageJsonPath = `${root}/package.json`;
    for (const [path, content] of Object.entries(
      seedFilesForStarter(starterById(preset.id), root),
    )) {
      // package.json is install-owned after boot; rewriting it here drops
      // npm-installed deps on reload while the owner/index reset already seeds it.
      if (path === rootPackageJsonPath) continue;
      workspaceOwner().writeFile(path, content);
    }
  }

  // Seed the workspace for a preset — owner-only (single store owner; the page holds no authoritative fs).
  function seedViteWorkspace(preset: Preset): void {
    seedWorkspaceOwner(preset);
  }

  function devServerSession(): TerminalSessionSnapshot {
    if (devServerSessionId) {
      const previous = manager.snapshot(devServerSessionId);
      if (previous.status === 'idle' && !hiddenSessionIds.has(previous.id)) {
        manager.select(previous.id);
        refreshTerminalState();
        return previous;
      }
    }
    const active = manager.snapshot(manager.activeSessionId());
    if (active.status === 'idle') return active;
    const idle = visibleSessions().find((session) => session.status === 'idle');
    if (idle) {
      manager.select(idle.id);
      refreshTerminalState();
      return idle;
    }
    return createSession();
  }

  function isVisibleTerminalSession(id: string): boolean {
    try {
      manager.snapshot(id);
      return !hiddenSessionIds.has(id);
    } catch {
      return false;
    }
  }

  async function waitForDevServerStop(): Promise<void> {
    while (devServerStatus() !== 'stopped') {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }

  function terminalStatus(id: string | null): TerminalSessionSnapshot['status'] | undefined {
    if (!id) return undefined;
    try {
      return manager.snapshot(id).status;
    } catch {
      return undefined;
    }
  }

  async function waitForTerminalIdle(id: string | null): Promise<void> {
    while (terminalStatus(id) === 'running') {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }

  async function waitForDevServerBoot(sessionId: string, generation: number): Promise<void> {
    while (generation === devServerRestartGeneration) {
      if (devServerStatus() === 'running' || terminalStatus(sessionId) === 'idle') return;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }

  async function restartDevServer(sessionId: string): Promise<void> {
    const generation = ++devServerRestartGeneration;
    // Stop the running dev command in its session (ADR-0148 co-resident dev server): the owner aborts
    // the run → the co-resident dev server stops → `devServerStatus` → 'stopped'.
    if (devServerSessionId) manager.stop(devServerSessionId);
    await waitForDevServerStop();
    await waitForTerminalIdle(devServerSessionId);
    if (generation !== devServerRestartGeneration) return;
    const targetSessionId = isVisibleTerminalSession(sessionId) ? sessionId : devServerSession().id;
    devServerSessionId = targetSessionId;
    manager.clear(targetSessionId); // fresh console for the switched-in project
    // Boot lines follow the ACTIVE STARTER (store-derived, ADR-0165 §4): on a
    // switch the store has re-pointed to the destination project's starter, so a
    // restart boots ITS template — never the stale picked-preset starter.
    void runTerminalSequence(
      targetSessionId,
      presetBootLines(presetForId(activeStarterId()), activeRoot()),
    );
    await waitForDevServerBoot(targetSessionId, generation);
  }

  function reinitializeTsForPickedPreset(preset: Preset): void {
    openPresetEditorTabs(preset);
    setTsProjectRevision((revision) => revision + 1);
  }

  async function runVitePreset(preset: Preset, tsGate?: TsPresetTransitionGate): Promise<void> {
    try {
      setActivePreset(preset.id);
      await machine.loadPreset(preset);
      discardPendingProgramWrite();
      seedViteWorkspace(preset);
      const restartNeeded =
        devServerStatus() !== 'stopped' || terminalStatus(devServerSessionId) === 'running';
      const restartSessionId = devServerSessionId;
      let session: TerminalSessionSnapshot | undefined;
      if (!restartNeeded) {
        session = devServerSession();
        devServerSessionId = session.id;
      }
      // Tell the owner which template/runtime the next co-resident dev server boots
      // (ADR-0148 co-resident dev server): the persistent owner is spawned once, so a node-server preset
      // must update the runtime before the dev line runs. `slug` keys the install
      // stamp/RIFTY_RFV_SLUG to the ACTIVE ROOT (store.activeId — 'scratch' on a
      // gallery pick), matching the owner spawn; `templateId`/`setup` follow the
      // picked preset (the new active starter for this scratch).
      await workspaceOwner().setDevConfig({
        templateId: templateForPreset(preset).id,
        slug: store.activeId(),
        setup: preset.setup,
      });
      if (restartNeeded) {
        if (restartSessionId) await restartDevServer(restartSessionId);
        reinitializeTsForPickedPreset(preset);
        return;
      }
      if (!session) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      manager.clear(session.id); // fresh console for the switched-in project
      const generation = ++devServerRestartGeneration;
      void runTerminalSequence(session.id, presetBootLines(preset, activeRoot()));
      await waitForDevServerBoot(session.id, generation);
      reinitializeTsForPickedPreset(preset);
    } finally {
      tsGate?.resolve();
    }
  }

  // ADR-0165 §3 switch = owner teardown + respawn at the next root, wired to the
  // launcher/chip (`onLauncherSwitch`) and the switch dialog (`applyPending`).
  // Strictly sequential via requestSwitch — never two owners on the singleton OPFS
  // backend. The dirty-scratch confirm already ran in the store, so `isDirty` is
  // false here and the `save`/`discard` hooks go unused; durable Save persists
  // separately via `onConfirmSave` → the owner `index-save` frame. `awaitReady`
  // uses the snapshot-port handshake as the ready gate (the owner publishes at boot).
  async function switchTo(nextActiveId: ActiveId): Promise<boolean> {
    // The dirty-scratch confirm already ran in the store (`requestSwitch` opened the
    // switch dialog), so by the time we get here the switch is committed — the store
    // has flipped `activeId` to the destination, so `activeTemplate()`/`activeStarterId()`
    // already describe the NEXT project. Gate stays false (store decided already).
    // `O` infers from currentOwner (WorkspaceOwnerHandle) — no explicit generic.

    // ADR-0165 §3: PERSIST the new active root to the durable index BEFORE teardown.
    // A switch otherwise never updates the on-disk `activeId`, so the respawned
    // owner re-publishes the STALE activeId and `hydrateIndex` reverts the switch
    // (a race), and a reload boots the wrong root. Post to the CURRENT owner and
    // wait for its durable ack, so the new owner boots reading the right id.
    // Memory mode has no durable index → page-mirror only.
    if (!saveAffordance(storageMode).ephemeral) {
      await setActiveIndex(workspaceOwner().snapshotPort, nextActiveId);
    }
    return await requestSwitch({
      currentOwner: workspaceOwner(),
      nextRoot: rootForId(nextActiveId),
      nextSlug: nextActiveId,
      isDirty: () => false,
      confirmDiscard: async () => globalThis.confirm?.('Discard unsaved scratch changes?') ?? true,
      save: async () => {
        /* unused: the store ran the dirty-confirm; durable Save persists via onConfirmSave → owner index-save */
      },
      discard: async () => {
        /* unused: the store ran the dirty-confirm; durable reset persists via onConfirmReset → owner index-reset */
      },
      spawn: ({ root, slug }) =>
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
      awaitReady: (next) =>
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
      rewireBridges: (next) => setOwnerHandle(next), // signal swap re-runs every bridge effect
      restartDevServer: async () => {
        setDevServerStatus('stopped');
        await manager.rebindOwner(workspaceOwner());
        if (devServerSessionId) await restartDevServer(devServerSessionId);
      },
      clearTerminal: () => {
        if (devServerSessionId) manager.clear(devServerSessionId);
      },
    });
  }

  onMount(() => {
    // Seed the owner workspace (idempotent). The default README is seeded
    // owner-side in `seedProject` (single store owner — no page store to write).
    try {
      seedViteWorkspace(DEFAULT_PRESET);
    } catch {
      /* best-effort seeding */
    }
    initialRunTimer = setTimeout(() => {
      void runVitePreset(DEFAULT_PRESET);
    }, 0);
  });

  onCleanup(() => {
    if (initialRunTimer) clearTimeout(initialRunTimer);
    if (toastTimer) clearTimeout(toastTimer);
    flushPendingProgramWrite();
    manager.dispose();
    workspaceOwner().close(); // terminate the persistent owner worker (ADR-0146)
  });

  // ─── Launcher + dialog wiring (ADR-0165 §9) ──────────────────────────────────
  // Save/Rename dialog input text, held page-side (the dialog is controlled).
  const [saveName, setSaveName] = createSignal('');
  const [renameName, setRenameName] = createSignal('');
  // A switch the user chose to "Save scratch, then continue" — the pending target
  // is stashed across the Save dialog (which replaces the switch dialog) so the
  // switch resumes AFTER the save commits (ADR-0165 §9). null = a plain Save CTA.
  const [pendingAfterSave, setPendingAfterSave] = createSignal<{
    pendingStarter?: string;
    pendingId?: string;
  } | null>(null);
  let pendingSaveApplied: Promise<boolean> | null = null;
  let pendingSaveDurability: Promise<boolean> | null = null;
  let pendingSwitch: Promise<boolean> | null = null;

  function trackSave(
    id: string,
    save: {
      readonly applied: Promise<ProjectIndex | null>;
      readonly durable: Promise<ProjectIndex | null>;
    },
  ): { applied: Promise<boolean>; durable: Promise<boolean> } {
    const appliedWait = (async (): Promise<boolean> => {
      const index = await save.applied;
      return index?.projects.some((p) => p.id === id) === true;
    })();
    const applied = appliedWait.finally(() => {
      if (pendingSaveApplied === applied) pendingSaveApplied = null;
    });
    pendingSaveApplied = applied;

    const durableWait = (async (): Promise<boolean> => {
      const index = await save.durable;
      return index?.projects.some((p) => p.id === id) === true;
    })();
    const durable = durableWait.finally(() => {
      if (pendingSaveDurability === durable) pendingSaveDurability = null;
    });
    pendingSaveDurability = durable;
    return { applied, durable };
  }

  async function waitForPendingSaveApplied(): Promise<boolean> {
    return (await pendingSaveApplied?.catch(() => false)) ?? true;
  }

  async function waitForPendingSaveDurable(): Promise<boolean> {
    return (await pendingSaveDurability?.catch(() => false)) ?? true;
  }

  function trackSwitch(run: Promise<boolean>): Promise<boolean> {
    const tracked = run
      .catch((err: unknown) => {
        console.error('[project-switch] switch failed', err);
        const message = err instanceof Error ? err.message : String(err);
        store.setToast({ kind: 'error', text: `Switch failed: ${message}` });
        return false;
      })
      .finally(() => {
        if (pendingSwitch === tracked) pendingSwitch = null;
      });
    pendingSwitch = tracked;
    return tracked;
  }

  async function waitForPendingSwitch(): Promise<boolean> {
    return (await pendingSwitch) ?? true;
  }

  let programWriteTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingProgramWrite: { path: string; content: string } | undefined;

  function flushPendingProgramWrite(): void {
    const pending = pendingProgramWrite;
    if (!pending) return;
    discardPendingProgramWrite();
    workspaceOwner().writeFile(pending.path, pending.content);
    notifyFileWritten(pending.path, pending.content); // ADR-0165 §57: REAL write → dirty
  }

  function discardPendingProgramWrite(): void {
    if (programWriteTimer) {
      clearTimeout(programWriteTimer);
      programWriteTimer = undefined;
    }
    pendingProgramWrite = undefined;
  }

  function scheduleProgramWrite(path: string, content: string): void {
    pendingProgramWrite = { path, content };
    if (programWriteTimer) clearTimeout(programWriteTimer);
    programWriteTimer = setTimeout(() => {
      programWriteTimer = undefined;
      flushPendingProgramWrite();
    }, 300);
  }

  // Establish a fresh scratch from a starter in the OWNER index (ADR-0165 §6): the
  // page-mirror flip is immediate UX; this re-creates the durable scratch entry +
  // re-seeds /scratch so the NEXT Save's `saveScratchAsProject` precondition holds
  // (after a prior Save the owner index is `scratch:null`). Read the port at fire
  // time; skipped in memory mode (no durable index). The owner is not respawned on
  // a pick — it stays rooted at /scratch and re-seeds the live tree.
  function durableNewScratch(id: string): void {
    if (!saveAffordance(storageMode).ephemeral) {
      void newScratchIndex(workspaceOwner().snapshotPort, id).catch((err: unknown) =>
        console.error('[project-index] new scratch failed', err),
      );
    }
  }

  // Pick a Starter from the launcher (Starters tab). The store prompts on a dirty
  // scratch (switch dialog); a clean pick spins a fresh scratch AND boots the
  // chosen preset through the real worker lifecycle (the gallery pick = boot).
  async function onPickStarter(id: string): Promise<void> {
    if (!(await waitForPendingSwitch())) return;
    if (!(await waitForPendingSaveApplied())) return;
    const wasDirty = store.activeId() === 'scratch' && store.scratch()?.dirty === true;
    const tsGate = wasDirty ? undefined : beginTsPresetTransition();
    store.pickStarter(id);
    if (!wasDirty) {
      durableNewScratch(id);
      void runVitePreset(presetForId(id), tsGate);
    }
  }

  // Switch active root from the launcher/chip. The store gates a dirty scratch
  // (switch dialog); an applied switch drives the real owner respawn (switchTo).
  async function onLauncherSwitch(id: ActiveId): Promise<void> {
    if (!(await waitForPendingSwitch())) return;
    if (!(await waitForPendingSaveDurable())) return;
    const before = store.activeId();
    const ownerNeedsSwitch = workspaceOwner().root !== rootForId(id);
    store.requestSwitch(id);
    const prompted = store.dialog()?.kind === 'switch';
    if (!prompted && (store.activeId() !== before || ownerNeedsSwitch)) {
      void trackSwitch(switchTo(id));
    }
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

  // Open the Save-as-project dialog for the active scratch (ProjectsTab save CTA).
  function openSaveDialog(): void {
    setSaveName('');
    store.openDialog({ kind: 'save', defaultName: '' });
  }

  // Confirm Save: the store flips the mirror pointer; a fresh page id is allocated
  // (the owner reconciles the on-disk move via saveScratchAsProject + its index).
  // ADR-0165 §8 fidelity: a memory-mode save is EPHEMERAL — its toast must NEVER
  // read like a durable `Saved as <name>`. saveAffordance(storageMode) is the one
  // source shared with the status-bar badge, so the two surfaces cannot drift.
  async function onConfirmSave(): Promise<void> {
    const name = saveName().trim();
    if (!name) return;
    // Collision-free project id (crypto.randomUUID, Math.random fallback) — a
    // collision would make saveScratchAsProject throw `already exists` owner-side
    // while the page optimistically flipped activeId onto another project's tree.
    const id = `p-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)}`;
    const ephemeral = saveAffordance(storageMode).ephemeral;
    const durableSave = ephemeral
      ? {
          applied: Promise.resolve<ProjectIndex | null>(null),
          durable: Promise.resolve<ProjectIndex | null>(null),
        }
      : (() => {
          const phases = saveProjectIndexPhases(
            workspaceOwner().snapshotPort,
            id,
            name,
            activeStarterId(),
          );
          return {
            applied: phases.applied.catch((err: unknown) => {
              console.error('[project-index] save apply failed', err);
              const message = err instanceof Error ? err.message : String(err);
              store.setToast({ kind: 'error', text: `Save failed: ${message}` });
              return null;
            }),
            durable: phases.durable.catch((err: unknown) => {
              console.warn('[project-index] save durability still pending', err);
              return null;
            }),
          };
        })();
    // ADR-0165 §7 durable Save: post the on-disk move FIRST (owner copies /scratch
    // → /projects/<id>, flips+persists the index, deletes /scratch), reading the
    // active STARTER while the store is still scratch-active (confirmSave below
    // flips activeId to the project). The owner re-publishes only after flush;
    // waiting here prevents a late save publish from reverting a following
    // starter-pick/switch. Read the port at fire time (the live channel). Skipped
    // in memory mode (EPHEMERAL — no durable tree).
    const saveWait = ephemeral
      ? { applied: Promise.resolve(true), durable: Promise.resolve(true) }
      : trackSave(id, durableSave);
    store.confirmSave(name, id);
    if (ephemeral) {
      store.setToast({ kind: 'info', text: `${name} · EPHEMERAL (session only)` });
    }
    // Save-then-continue resume (ADR-0165 §9): the switch dialog stashed a target.
    // Wait for the save to be DURABLE before switchTo hard-kills the owner (else
    // the committed tree races the teardown and the respawn boots empty), then apply.
    const pending = pendingAfterSave();
    if (pending) {
      setPendingAfterSave(null);
      if (await saveWait.durable) applyPendingTarget(pending);
    }
  }

  // Confirm Rename: post the durable on-disk rename to the owner (it rewrites the
  // index `name` + re-publishes) reading the dialog's target id BEFORE the store
  // flips it, then flip the page mirror (immediate UX; the owner reconciles). Read
  // the port at fire time (memory mode has no durable index — page-mirror only).
  function onConfirmRename(): void {
    const d = store.dialog();
    const id = d && d.kind === 'rename' ? d.id : null;
    const name = renameName().trim();
    if (id && name && !saveAffordance(storageMode).ephemeral) {
      void renameProjectIndex(workspaceOwner().snapshotPort, id, name).catch((err: unknown) =>
        console.error('[project-index] rename failed', err),
      );
    }
    store.confirmRename(renameName());
  }

  // Re-seed the live editor program + restart the dev server after the OWNER
  // re-seeded the ACTIVE root (ADR-0165 §6). The owner already republished the
  // file snapshot (reset-refresh hook), so the explorer is fresh; here the page
  // resets the program tab to the clean starter source (echo-suppressed in
  // EditorHost → no re-dirty) and reboots the dev server so the preview reflects
  // the restored tree (node_modules was wiped → the boot re-installs).
  function refreshActiveAfterReset(): void {
    const preset = presetForId(activeStarterId());
    machine.setSource(preset.source);
    openPresetEditorTabs(preset);
    if (devServerStatus() !== 'stopped' && devServerSessionId) {
      void restartDevServer(devServerSessionId);
    }
  }

  // Confirm Reset (ADR-0165 §6): a REAL on-disk re-seed for both the active scratch
  // (index-reset) and a named project (index-reset-project) — the owner wipes +
  // re-derives the tree from the starter bundle and re-publishes. When the reset
  // target is the ACTIVE root, also refresh the live editor + dev server so the
  // "restores the clean starter files" promise is true on screen, not just on disk.
  // Read the port at fire time; memory mode skips the durable post (page-mirror only).
  function onConfirmReset(): void {
    const d = store.dialog();
    const id = d && d.kind === 'reset' ? d.id : null;
    if (id && !saveAffordance(storageMode).ephemeral) {
      const reset =
        id === 'scratch'
          ? resetScratchIndex(workspaceOwner().snapshotPort, activeStarterId())
          : resetProjectIndex(workspaceOwner().snapshotPort, id);
      void reset.catch((err: unknown) => console.error('[project-index] reset failed', err));
    }
    store.confirmReset();
    if (id && id === store.activeId()) refreshActiveAfterReset();
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

  // Apply a confirmed switch target — UNGUARDED (the user already chose Save or
  // Discard, ADR-0165 §9). Uses the store's `confirm*` transitions, NOT the
  // dirty-guarded `requestSwitch`/`pickStarter`: re-invoking the guarded ones from
  // a still-dirty scratch would re-open the switch dialog and never flip activeId,
  // so the owner would respawn at the new root with the OLD template/starter.
  function applyPendingTarget(target: { pendingStarter?: string; pendingId?: string }): void {
    if (target.pendingStarter) {
      const tsGate = beginTsPresetTransition();
      store.confirmPickStarter(target.pendingStarter);
      durableNewScratch(target.pendingStarter);
      void runVitePreset(presetForId(target.pendingStarter), tsGate);
    } else if (target.pendingId) {
      store.confirmSwitchTo(target.pendingId);
      void trackSwitch(switchTo(target.pendingId));
    }
  }

  // Discard-then-continue: drop the switch dialog and apply the pending target
  // immediately (the unnamed draft is kept on disk; only the save-as-project is
  // skipped — ADR-0165 §9).
  function onSwitchDiscardThen(): void {
    const d = store.dialog();
    store.setDialog(null);
    if (d?.kind === 'switch') applyPendingTarget(d);
  }

  // Save-then-continue: stash the pending target, then open the Save dialog (which
  // replaces the switch dialog). The switch RESUMES in onConfirmSave AFTER the save
  // commits — so "Save scratch, then continue" actually continues (ADR-0165 §9).
  function onSwitchSaveThen(): void {
    const d = store.dialog();
    if (d?.kind === 'switch')
      setPendingAfterSave({ pendingStarter: d.pendingStarter, pendingId: d.pendingId });
    openSaveDialog();
  }

  // A port is previewable iff it is a registered preview port (ADR-0155 multi-port:
  // the dev-server port is itself a registry entry when running, and each node
  // server's port is added on listen). Membership-only — a non-registered port
  // never yields a URL — while still un-gating from devServerRunning() so a
  // node-only preview's "open in new tab" no longer silently no-ops (Fidelity).
  const isLivePreviewPort = (port: number): boolean => previewPorts().some((p) => p.port === port);
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

  function onProgramChange(next: string): void {
    machine.setSource(next);
    // SSoT (ADR-0148 co-resident dev server; single store owner, page holds no
    // authoritative fs): push the program edit to the OWNER (the single store) so
    // the co-resident dev server HMR-updates and the archive sees it. The path is
    // ROOT-RELATIVE (ADR-0165 §4) so the edit reaches the active template entry.
    // Debounced like ordinary file tabs: Monaco emits one content event per
    // keystroke, and writing each one floods Vite with duplicate HMR updates.
    const programPath = programMirrorPath(activeRoot(), activeTemplate());
    scheduleProgramWrite(programPath, next);
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
    if (devServerRunning()) {
      items.push({
        id: 'act:open-preview',
        section: 'Commands',
        label: 'Open preview in new tab',
        icon: 'external-link',
        run: () => openPreviewTab(),
      });
    }
    if (devServerStatus() !== 'stopped' && devServerSessionId) {
      const sessionId = devServerSessionId;
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
      run: () => void downloadWorkspaceArchive(),
    });
    items.push({
      id: 'act:import-workspace',
      section: 'Commands',
      label: 'Import workspace archive',
      hint: workspaceArchiveBlocked()
        ? 'Stop the dev server to import into the editable workspace'
        : undefined,
      icon: 'folder-open',
      run: () => chooseWorkspaceArchive(),
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
      // Escape closes the topmost project overlay (ADR-0165 §9 a11y): a project
      // dialog first (drop any stashed Save-then pending), else the launcher modal.
      // The command palette owns its own Escape, so leave it alone.
      if (e.key === 'Escape' && !paletteOpen()) {
        if (store.dialog()) {
          e.preventDefault();
          setPendingAfterSave(null);
          store.setDialog(null);
        } else if (store.launcherOpen()) {
          e.preventDefault();
          store.closeLauncher();
        }
      }
    };
    globalThis.window?.addEventListener('keydown', onKey, true);
    onCleanup(() => globalThis.window?.removeEventListener('keydown', onKey, true));
  });

  const livePillLabel = (): string =>
    devServerStatus() === 'running'
      ? `LIVE :${machine.realVitePort()}`
      : devServerStatus() === 'starting'
        ? 'STARTING'
        : 'STOPPED';

  const modeLabel = (): string =>
    machine.mode() === 'dev'
      ? 'Dev · port 3000'
      : machine.mode() === 'real-vite'
        ? devServerStatus() === 'running'
          ? `${activeTemplate().displayName} · port ${machine.realVitePort()}`
          : `${activeTemplate().displayName} · ${devServerStatus()}`
        : activeTemplate().displayName;

  const terminalModeHint = (): TerminalModeHint => ({
    label: 'Shell',
    detail: `Commands run in ${activeRoot()}; running programs own stdin.`,
  });
  const programTitle = (): string => activeTemplate().entry.relativePath.replace(/^\/+/, '');
  // Mount the preview when the dev server is up/starting OR any node server
  // registered a port (ADR-0155 §3 / ADR-0157 review C1): a `node server.js` with
  // the dev server stopped must still show its preview. Keep the `!== 'stopped'`
  // disjunct so the panel shows during the dev 'starting' window (before the slot lands).
  const hasPreview = (): boolean => devServerStatus() !== 'stopped' || previewPorts().length > 0;
  const isOpfs = storageMode === 'opfs';

  return (
    <div class="rf-app">
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

        <span class="rf-livepill" data-state={devServerStatus()} title={modeLabel()}>
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
            {/* SSoT (ADR-0148 co-resident dev server): the explorer ALWAYS reflects the OWNER snapshot
                (one source of truth) + the lazy node_modules read-port — no
                `vite`-gated backing-store swap. */}
            <FileExplorer
              vfs={snapshotFs}
              root={activeRoot()}
              nodeModules={nodeModulesProp()}
              visible={!layout.sidebarCollapsed()}
              activePath={activeFilePath()}
              onOpenFile={(path) => editorApi?.openFile(path)}
            />
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
              <EditorHost
                programValue={machine.source}
                programPath={() => programMirrorPath(activeRoot(), activeTemplate())}
                programTitle={programTitle}
                root={activeRoot}
                onProgramChange={onProgramChange}
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
                onFileWritten={writeWorkspaceFile}
                readNodeModulesFile={readNodeModulesFile()}
                previewUrl={previewUrl}
                onOpenPreviewTab={openPreviewTab}
                onError={flashError}
              />

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
                  initialPort={previewPorts().at(-1)?.port ?? machine.realVitePort()}
                  onOpenTab={openPreviewTab}
                  onNotify={flashToast}
                  ports={previewPorts}
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
          onExport={() => void downloadWorkspaceArchive()}
          exportDisabled={workspaceArchiveBlocked()}
          exportTitle={
            workspaceArchiveBlocked()
              ? 'Stop the dev server to archive the editable workspace'
              : 'Download the editable workspace as a .json archive'
          }
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
        onClose={() => store.closeLauncher()}
        onSearch={(q) => store.setQ(q)}
        onCat={(cat) => store.setCat(cat)}
        onPickStarter={onPickStarter}
        onSwitch={onLauncherSwitch}
        onSave={openSaveDialog}
        onMenu={(id) => store.setMenuFor(id)}
        onMenuAction={onMenuAction}
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
          setPendingAfterSave(null); // a cancelled Save-then-continue drops its pending switch
          store.setDialog(null);
        }}
        onConfirmSave={onConfirmSave}
        onConfirmRename={onConfirmRename}
        onConfirmReset={onConfirmReset}
        onConfirmDelete={() => store.confirmDelete()}
        onSwitchSaveThen={onSwitchSaveThen}
        onSwitchDiscardThen={onSwitchDiscardThen}
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
