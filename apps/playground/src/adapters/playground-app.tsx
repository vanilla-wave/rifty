import { detectCapabilities } from '@riftydev/runtime-js/env/capabilities';
import {
  type TerminalHistoryMode,
  type TerminalHistoryRecord,
  addTerminalHistoryRecord,
} from '@riftydev/terminal/history';
import type { Diagnostic } from '@riftydev/ts-language-service/lsp-types';
import type { ProjectTerminalSnapshot } from '@riftydev/workbench';
import type {
  PlaygroundCatalogSnapshot,
  PlaygroundPreview,
  PlaygroundProjectPlan,
  PlaygroundScmSnapshot,
  PlaygroundScmSupportedChange,
  PlaygroundWorkbench,
} from '@riftydev/workbench/playground';
import type * as monaco from 'monaco-editor';
import { Show, createEffect, createMemo, createSignal, lazy, onCleanup, onMount } from 'solid-js';
import { type BootResult, isCrossOriginIsolated, swErrorBannerMessage } from '../boot.ts';
import { BottomPanel } from '../components/BottomPanel.tsx';
import { CapabilitiesPanel } from '../components/CapabilitiesPanel.tsx';
import { CommandPalette, type PaletteItem } from '../components/CommandPalette.tsx';
import { DegradedBanner } from '../components/DegradedBanner.tsx';
import { FileExplorer, type FileExplorerMutations } from '../components/FileExplorer.tsx';
import { Launcher } from '../components/Launcher.tsx';
import { PreviewPanel } from '../components/PreviewPanel.tsx';
import { ProjectDialogs } from '../components/ProjectDialogs.tsx';
import { ProjectSwitcherChip } from '../components/ProjectSwitcherChip.tsx';
import type { RowAction } from '../components/ProjectsTab.tsx';
import { ScmPanel } from '../components/ScmPanel.tsx';
import { Splitter } from '../components/Splitter.tsx';
import { StatusBar } from '../components/StatusBar.tsx';
import type { TerminalDims, TerminalModeHint } from '../components/TerminalPanel.tsx';
import type { EditorApi, EditorOpenFileOptions } from '../components/editor-host-core.ts';
import { Icon } from '../components/icons.tsx';
import { DELETE_GRACE_MS } from '../glue/app-project-store.ts';
import { resetBrowserSandboxState } from '../glue/browser-sandbox-reset.ts';
import { browserLocalStorage } from '../glue/browser-storage.ts';
import { copyToClipboard } from '../glue/clipboard.ts';
import {
  degradedBannerVisible,
  saveAffordance,
  storageModeFromBoot,
  workspaceSaveMessage,
} from '../glue/degraded-storage.ts';
import { looksBinary } from '../glue/fs-ops.ts';
import { initialEditorFilesForPreset } from '../glue/initial-editor-files.ts';
import { initialLauncherTab, loadLauncherTab, saveLauncherTab } from '../glue/launcher-prefs.ts';
import { createPageStore } from '../glue/page-store.ts';
import { parsePresetDeepLink } from '../glue/preset-deep-link.ts';
import {
  hasPersistedProjectHint,
  reconcileProjectChoiceOnBoot,
  recordProjectPresenceHint,
  shouldOpenInstantProjectChoice,
} from '../glue/project-boot-policy.ts';
import { scratchDisplayName } from '../glue/project-display-name.ts';
import type { ActiveId, ProjectIndex } from '../glue/project-index.ts';
import type { ScmResourceRow } from '../glue/scm-status.ts';
import { withSlowProgress } from '../glue/slow-progress.ts';
import type { StarterGroup } from '../glue/starter.ts';
import { starterById } from '../glue/starter.ts';
import { pathFromTerminalFileLink } from '../glue/terminal-links.ts';
import type { TerminalPersistence } from '../glue/terminal-persistence.ts';
import { createTsDiagnosticsSync } from '../glue/ts-diagnostics-sync.ts';
import {
  clearTsLsInitDiagnostics,
  shouldPublishTsLsInitDiagnostic,
  upsertTsLsInitDiagnostic,
} from '../glue/ts-ls-init-diagnostic.ts';
import { lspToMonacoMarkers } from '../glue/ts-ls-monaco-markers.ts';
import type { TsLanguageServiceProvidersHandle } from '../glue/ts-ls-monaco-providers.ts';
import { createEditorOpQueue } from '../orchestration/editor-op-queue.ts';
import { DEFAULT_PRESET, PRESETS, type Preset } from '../presets.ts';
import { resolveProjectSpec } from '../templates/registry.ts';
import {
  type PlaygroundAppProjectContext,
  type PlaygroundAppRuntime,
  createPlaygroundAppRuntime,
} from './playground-app-runtime.ts';
import { rebindAfterPlaygroundTransitionFailure } from './playground-app-transition-recovery.ts';
import { createPlaygroundAppWorkbenchOwnership } from './playground-app-workbench-ownership.ts';
import { createDelayedCatalogDelete } from './playground-delete-policy.ts';
import { PlaygroundHealthBanner, createPlaygroundHealthUi } from './playground-health-ui.tsx';
import { toPlaygroundProjectPlan } from './playground-project-plan.ts';
import {
  type PlaygroundDocumentWriter,
  type PlaygroundProjectMirror,
  createPlaygroundDocumentWriter,
  createPlaygroundFileMutations,
  createPlaygroundProjectMirror,
  preparePlaygroundOwnerByteOperation,
  readPlaygroundEditorRemoteFile,
  readPlaygroundGitOriginalText,
} from './playground-project-view.ts';
import { savePlaygroundSession } from './playground-save.ts';
import { playgroundScmDiffPresentation } from './playground-scm-diff-presentation.ts';
import {
  SidebarRecoveryAffordance,
  createSidebarTogglePaletteItem,
} from './playground-sidebar-recovery.tsx';
import { selectPlaygroundSidebarView } from './playground-sidebar-view.ts';
import { type PlaygroundTerminalUi, createPlaygroundTerminalUi } from './playground-terminal-ui.ts';
import type { TerminalSessionSnapshot } from './playground-terminal-ui.ts';
import { createPlaygroundStoreToastDismissal } from './playground-toast-policy.ts';
import type { PlaygroundTsDevHooksHandle } from './playground-ts-dev-hooks.ts';
import { useLayout } from './useLayout.ts';
import { useMode } from './useMode.ts';

const EditorHost = lazy(() =>
  import('../components/EditorHost.tsx').then((module) => ({ default: module.EditorHost })),
);

let editorStackWarm: Promise<unknown> | undefined;
function warmEditorStack(): void {
  if (editorStackWarm !== undefined) return;
  editorStackWarm = Promise.all([
    import('../components/EditorHost.tsx'),
    import('../glue/ts-ls-monaco-providers.ts'),
  ]).catch((error: unknown) => {
    editorStackWarm = undefined;
    console.warn('[editor] lazy stack warm failed', error);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function catalogIndex(snapshot: PlaygroundCatalogSnapshot, hiddenProjectId?: string): ProjectIndex {
  return {
    activeId: snapshot.active?.kind === 'project' ? snapshot.active.id : ('scratch' as const),
    scratch:
      snapshot.scratch === null
        ? null
        : {
            starter: snapshot.scratch.starterId,
            dirty: snapshot.scratch.dirty,
            editedAt: snapshot.scratch.editedAt,
          },
    projects: snapshot.projects
      .filter((project) => project.id !== hiddenProjectId)
      .map((project) => ({
        id: project.id,
        name: project.name,
        starter: project.starterId,
        editedAt: project.editedAt,
      })),
  };
}

function presetForId(id: string): Preset {
  return PRESETS.find((preset) => preset.id === id) ?? DEFAULT_PRESET;
}

function planFor(projectId: string, starterId: string): PlaygroundProjectPlan {
  const preset = presetForId(starterId);
  return toPlaygroundProjectPlan({
    projectId,
    starter: starterById(preset.id),
    setup: preset.setup,
  });
}

function projectFileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1) || 'project';
}

function decodeText(label: string, bytes: Uint8Array): string {
  if (looksBinary(bytes)) throw new Error(`${label} is binary; text diff is unavailable`);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8; text diff is unavailable`);
  }
}

function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  queueMicrotask(() => URL.revokeObjectURL(url));
}

interface BoundProject {
  readonly editorContextKey: string;
  readonly context: PlaygroundAppProjectContext;
  readonly mirror: PlaygroundProjectMirror;
  readonly documents: PlaygroundDocumentWriter;
  readonly terminal: PlaygroundTerminalUi;
  readonly typescriptBootReady: Promise<void>;
  readonly mutations: FileExplorerMutations;
  readonly unsubscribeScm: () => void;
  readonly unsubscribePreviews: () => void;
  readonly unsubscribeTerminal: () => void;
}

export interface AppProps {
  readonly boot: BootResult;
  readonly terminalPersistence: TerminalPersistence;
  readonly workbench: PlaygroundWorkbench;
}

export function App(props: AppProps) {
  const capabilities = detectCapabilities();
  const layout = useLayout();
  const machine = useMode({});
  const initialStorageMode = storageModeFromBoot(props.boot);
  const [storageMode, setStorageMode] = createSignal<'opfs' | 'memory'>(initialStorageMode);
  const [swBannerDismissed, setSwBannerDismissed] = createSignal(false);
  const [bannerDismissed, setBannerDismissed] = createSignal(false);
  const [activeFile, setActiveFile] = createSignal('');
  const [activeFilePath, setActiveFilePath] = createSignal<string>();
  const [activeLang, setActiveLang] = createSignal('plaintext');
  const [toast, setToast] = createSignal<{ message: string; tone: 'error' | 'success' } | null>(
    null,
  );
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [paletteData, setPaletteData] = createSignal<readonly PaletteItem[]>([]);
  const [projectBusy, setProjectBusy] = createSignal(false);
  const [instantPrepareLabel, setInstantPrepareLabel] = createSignal<string>();
  const [workbenchReady, setWorkbenchReady] = createSignal(false);
  const [bound, setBound] = createSignal<BoundProject>();
  const [sessions, setSessions] = createSignal<readonly TerminalSessionSnapshot[]>([]);
  const [activeSessionId, setActiveSessionId] = createSignal('');
  const [terminalFocusEpoch, setTerminalFocusEpoch] = createSignal(0);
  const [terminalHistory, setTerminalHistory] = createSignal<readonly TerminalHistoryRecord[]>(
    props.terminalPersistence.initialHistory,
  );
  const [diagnostics, setDiagnostics] = createSignal<ReadonlyMap<string, readonly Diagnostic[]>>(
    new Map(),
  );
  const [scmSnapshot, setScmSnapshot] = createSignal<PlaygroundScmSnapshot>({
    history: [],
    changes: [],
  });
  const [previewPorts, setPreviewPorts] = createSignal<readonly PlaygroundPreview[]>([]);
  const [runState, setRunState] = createSignal<'stopped' | 'starting' | 'running'>('stopped');
  const [saveName, setSaveName] = createSignal('');
  const [renameName, setRenameName] = createSignal('');
  const [pendingSwitch, setPendingSwitch] = createSignal<{
    readonly starterId?: string;
    readonly projectId?: string;
  } | null>(null);
  const healthUi = createPlaygroundHealthUi();

  const store = createPageStore();
  store.setStorage(initialStorageMode);
  const workspaceAtRisk = (): boolean => store.dirty() || healthUi.persistenceAtRisk();
  const workbenchUnavailable = (): boolean =>
    healthUi.issues().some((issue) => issue.kind === 'unavailable' || issue.kind === 'fatal');
  const storeToastDismissal = createPlaygroundStoreToastDismissal((expected) => {
    if (store.toast() === expected) store.setToast(null);
  });
  createEffect(() => storeToastDismissal.update(store.toast()));
  const presetDeepLink = parsePresetDeepLink(globalThis.location?.search ?? '');
  const deepLinkStarterId = PRESETS.some((preset) => preset.id === presetDeepLink.presetId)
    ? presetDeepLink.presetId
    : undefined;
  if (presetDeepLink.presetId !== undefined && deepLinkStarterId === undefined) {
    console.warn(`[rifty] unknown preset ${JSON.stringify(presetDeepLink.presetId)}`);
  }

  let runtime: PlaygroundAppRuntime | null = null;
  let editorContextId = 0;
  let latestTerminalState: ProjectTerminalSnapshot = Object.freeze({
    cwd: '/',
    env: Object.freeze({}),
  });
  const workbenchOwnership = createPlaygroundAppWorkbenchOwnership(props.workbench);
  let unsubscribeCatalog: (() => void) | null = null;
  let catalogChoiceReconciled = false;
  let initialization: Promise<void> | null = null;
  let editorApi: EditorApi | undefined;
  const editorOpQueue = createEditorOpQueue<EditorApi>();
  let editorDocumentUnsubscribe: (() => void) | null = null;
  let diagnosticSync: ReturnType<
    typeof createTsDiagnosticsSync<Diagnostic, monaco.editor.IMarkerData>
  > | null = null;
  let providerHandle: TsLanguageServiceProvidersHandle | null = null;
  let tsDevHooks: PlaygroundTsDevHooksHandle | null = null;
  let editorBindingEpoch = 0;
  let hiddenDeleteId: string | undefined;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const terminalWriters = new Map<string, (chunk: string, stream?: 'stdout' | 'stderr') => void>();

  function flashToast(message: string, tone: 'error' | 'success'): void {
    setToast({ message, tone });
    if (toastTimer !== undefined) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToast(null), tone === 'success' ? 2200 : 4200);
  }

  function flashError(message: string): void {
    flashToast(message, 'error');
  }

  function currentRuntime(): PlaygroundAppRuntime {
    if (runtime === null) throw new Error('Playground Workbench is not ready');
    return runtime;
  }

  function projectAdmissionBlocked(): boolean {
    return !workbenchReady() || projectBusy() || workbenchUnavailable();
  }

  function effectiveRunState(): 'stopped' | 'starting' | 'running' {
    return previewPorts().length > 0 ? 'running' : runState();
  }

  function terminalSession(project: BoundProject, id: string): TerminalSessionSnapshot {
    const session = project.terminal.sessions().find((candidate) => candidate.id === id);
    if (session === undefined) throw new Error(`Unknown terminal ${id}`);
    return session;
  }

  function persistTerminalSession(project: BoundProject, id: string): void {
    const session = terminalSession(project, id);
    latestTerminalState = Object.freeze({
      cwd: session.cwd,
      env: Object.freeze({ ...session.env }),
    });
    void props.terminalPersistence.saveState(latestTerminalState);
  }

  function activeStarterId(): string {
    const current = bound()?.context.plan.starterId;
    if (current !== undefined) return current;
    if (store.activeId() === 'scratch') return store.scratch()?.starter ?? DEFAULT_PRESET.id;
    return (
      store.projects().find((project) => project.id === store.activeId())?.starter ??
      DEFAULT_PRESET.id
    );
  }

  function activePlan(): PlaygroundProjectPlan | null {
    const snapshot = runtime?.catalog.snapshot();
    if (snapshot === undefined || snapshot.active === null) return null;
    const active = snapshot.active;
    if (active.kind === 'scratch') {
      if (snapshot.scratch === null) throw new Error('Active Scratch has no catalog record');
      return planFor('scratch', snapshot.scratch.starterId);
    }
    const project = snapshot.projects.find((candidate) => candidate.id === active.id);
    if (project === undefined) throw new Error(`Active project ${active.id} is missing`);
    return planFor(project.id, project.starterId);
  }

  function planForTarget(id: ActiveId): PlaygroundProjectPlan {
    const snapshot = currentRuntime().catalog.snapshot();
    if (id === 'scratch') {
      if (snapshot.scratch === null) throw new Error('Scratch does not exist');
      return planFor('scratch', snapshot.scratch.starterId);
    }
    const project = snapshot.projects.find((candidate) => candidate.id === id);
    if (project === undefined) throw new Error(`Project ${id} does not exist`);
    return planFor(id, project.starterId);
  }

  function activeGlyph(): {
    readonly text: string;
    readonly color: string;
    readonly label: string;
    readonly port: number;
  } {
    return glyphFor(activeStarterId());
  }

  function glyphFor(starterId: string): {
    readonly text: string;
    readonly color: string;
    readonly label: string;
    readonly port: number;
  } {
    const preset = presetForId(starterId);
    const spec = preset.templateId
      ? resolveProjectSpec(preset.templateId)
      : resolveProjectSpec('vite');
    return {
      text:
        preset.glyph?.text ??
        (spec.runtime === 'node-server' ? 'N' : spec.runtime === 'node-cli' ? 'CLI' : 'JS'),
      color: preset.glyph?.color ?? '#c7f05a',
      label: preset.label,
      port: spec.defaultPort,
    };
  }

  function activeName(): string {
    const current = bound()?.context.plan;
    if (current?.id === 'scratch') return scratchDisplayName(activeGlyph().label);
    if (current !== undefined) {
      return store.projects().find((project) => project.id === current.id)?.name ?? current.id;
    }
    return 'Choose project';
  }

  const gitStatus = createMemo<ReadonlyMap<string, string>>(() => {
    const map = new Map<string, string>();
    for (const change of scmSnapshot().changes) {
      if ('code' in change) map.set(change.path, change.code);
    }
    return map;
  });

  const initialEditorFiles = createMemo<readonly string[]>(() => {
    const current = bound();
    if (current === undefined) return [];
    return initialEditorFilesForPreset(presetForId(current.context.plan.starterId), '/');
  });

  function releaseEditorBinding(): void {
    editorBindingEpoch += 1;
    editorDocumentUnsubscribe?.();
    editorDocumentUnsubscribe = null;
    diagnosticSync?.dispose();
    diagnosticSync = null;
    tsDevHooks?.dispose();
    tsDevHooks = null;
    providerHandle?.dispose();
    providerHandle = null;
    editorApi = undefined;
    setDiagnostics(new Map());
  }

  function unbindEditor(): void {
    releaseEditorBinding();
    editorOpQueue.discardStale(false, '');
  }

  function bindEditor(api: EditorApi, project: BoundProject): void {
    if (bound() !== project) return;
    releaseEditorBinding();
    editorApi = api;
    const epoch = editorBindingEpoch;
    const isCurrent = (): boolean => !disposed && epoch === editorBindingEpoch && editorApi === api;
    const spec = resolveProjectSpec(project.context.plan.templateId);
    const clearTypeScriptInitFailure = (): void => {
      if (!isCurrent()) return;
      setDiagnostics((previous) => clearTsLsInitDiagnostics(new Map(previous)));
    };
    const reportTypeScriptFailure = (message: string): void => {
      if (!isCurrent()) return;
      setDiagnostics((previous) => {
        const next = new Map(previous);
        return shouldPublishTsLsInitDiagnostic(spec, message)
          ? upsertTsLsInitDiagnostic(next, '/', message)
          : clearTsLsInitDiagnostics(next);
      });
      console.warn('[typescript]', message);
    };
    const sync = createTsDiagnosticsSync({
      client: project.context.tools.typescript,
      debounceMs: 120,
      isSupportedPath: (path) => /\.(?:[cm]?[jt]sx?)$/.test(path),
      setMarkers: (path, markers) => api.setMarkers(path, [...markers]),
      setDiagnostics: (update) => setDiagnostics((previous) => update(new Map(previous))),
      toMarkers: lspToMonacoMarkers,
      beforeRequest: () => project.typescriptBootReady,
      warn: reportTypeScriptFailure,
    });
    let providerReady: Promise<void> = project.typescriptBootReady;
    const reinitialize = (): Promise<boolean> => {
      const run = providerReady
        .then(async () => {
          await project.context.tools.typescript.reinitialize();
          if (!isCurrent()) return false;
          clearTypeScriptInitFailure();
          await sync.reopenOpenDocuments();
          return isCurrent();
        })
        .catch((error: unknown) => {
          reportTypeScriptFailure(errorMessage(error));
          return false;
        });
      providerReady = run.then(() => undefined);
      return run;
    };
    diagnosticSync = sync;
    editorDocumentUnsubscribe = api.onDocument(sync.handleDocument);
    editorOpQueue.flush(api, project.editorContextKey);
    void Promise.all([
      import('../glue/ts-ls-monaco-providers.ts'),
      import('./playground-ts-dev-hooks.ts'),
    ]).then(([{ registerTsLanguageServiceProviders }, { installPlaygroundTsDevHooks }]) => {
      if (!isCurrent()) return;
      const providers = registerTsLanguageServiceProviders(project.context.tools.typescript, api, {
        beforeRequest: () => providerReady,
      });
      providerHandle = providers;
      tsDevHooks = installPlaygroundTsDevHooks({
        api,
        providers,
        reinitialize,
      });
    });
  }

  function withProjectEditor(project: BoundProject, operation: (api: EditorApi) => void): void {
    const contextReady = bound() === project;
    editorOpQueue.runOrQueue(
      contextReady ? editorApi : undefined,
      contextReady,
      project.editorContextKey,
      operation,
    );
  }

  async function openEditorFile(path: string, options?: EditorOpenFileOptions): Promise<void> {
    const project = bound();
    if (project === undefined) return;
    try {
      project.mirror.admitFile(await project.documents.open(path));
      withProjectEditor(project, (api) => api.openFile(path, options));
    } catch (error) {
      if (bound() === project) flashError(`Open failed: ${errorMessage(error)}`);
    }
  }

  async function saveActiveProject(): Promise<void> {
    const project = bound();
    if (project === undefined) return;
    const api = editorApi;
    await savePlaygroundSession({
      flushPendingEditorWrites: () => api?.flushPendingWrites() ?? Promise.resolve(),
      flushOwnerDurability: () => project.context.tools.awaitDurability(),
      isCurrent: () => bound() === project,
      reportSaved: () => flashToast(workspaceSaveMessage(storageMode()), 'success'),
      reportFailure: (error) => flashError(`Save failed: ${errorMessage(error)}`),
    });
  }

  async function disposeBound(): Promise<void> {
    healthUi.bindSession(undefined);
    const project = bound();
    if (project === undefined) return;
    const api = editorApi;
    if (api !== undefined) await api.flushPendingWrites();
    await project.documents.closeAll();
    unbindEditor();
    setBound(undefined);
    project.unsubscribeScm();
    project.unsubscribePreviews();
    project.unsubscribeTerminal();
    terminalWriters.clear();
    await project.terminal.dispose();
    project.mirror.dispose();
    setSessions([]);
    setActiveSessionId('');
    setScmSnapshot({ history: [], changes: [] });
    setPreviewPorts([]);
    setRunState('stopped');
  }

  async function bindProject(context: PlaygroundAppProjectContext): Promise<BoundProject> {
    warmEditorStack();
    const mirror = createPlaygroundProjectMirror(context.session.files);
    const documents = createPlaygroundDocumentWriter(context.session.documents);
    try {
      // The editor bytes and the first-write CAS base are the same Document
      // capture. Eager source-file loading already happened here; use that read
      // to establish provenance instead of sampling a handle on first write.
      await Promise.all(
        mirror.filePaths().map(async (path) => mirror.admitFile(await documents.open(path))),
      );
      const terminal = createPlaygroundTerminalUi(context.session);
      const unsubscribeScm = context.tools.scm.subscribe(setScmSnapshot);
      const unsubscribePreviews = context.tools.previews.subscribe(setPreviewPorts);
      const unsubscribeTerminal = terminal.subscribe((next) => {
        setSessions(next);
        const selected = terminal.activeSessionId();
        setActiveSessionId(
          next.some((session) => session.id === selected) ? selected : (next[0]?.id ?? ''),
        );
      });
      healthUi.bindSession(context.tools.health);
      const mutations = createPlaygroundFileMutations(context.session.files, mirror, (paths) =>
        preparePlaygroundOwnerByteOperation({
          editor: editorApi,
          documents,
          replacePaths: paths,
        }),
      );
      let releaseTypeScriptBoot!: () => void;
      const typescriptBootReady = new Promise<void>((resolve) => {
        releaseTypeScriptBoot = resolve;
      });
      const project: BoundProject = {
        editorContextKey: `${context.plan.id}\0${String(++editorContextId)}`,
        context,
        mirror,
        documents,
        terminal,
        typescriptBootReady,
        mutations,
        unsubscribeScm,
        unsubscribePreviews,
        unsubscribeTerminal,
      };
      const preset = presetForId(context.plan.starterId);
      await machine.loadPreset(preset);
      setBound(() => project);
      const run = terminal.startProject(
        activeName(),
        context.plan.kind === 'node-cli'
          ? { kind: 'node-cli', displayName: preset.label }
          : undefined,
      );
      setActiveSessionId(run.id);
      setRunState('starting');
      persistTerminalSession(project, run.id);
      void run.ready.then(
        () => {
          releaseTypeScriptBoot();
          if (bound() !== project) return;
          setRunState('running');
        },
        (error: unknown) => {
          releaseTypeScriptBoot();
          if (bound() !== project) return;
          setRunState('stopped');
          flashError(`Project start failed: ${errorMessage(error)}`);
        },
      );
      void run.exited.then(
        () => {
          if (bound() !== project) return;
          persistTerminalSession(project, run.id);
          setRunState('stopped');
        },
        (error: unknown) => {
          if (bound() !== project) return;
          persistTerminalSession(project, run.id);
          setRunState('stopped');
          flashError(`Project process failed: ${errorMessage(error)}`);
        },
      );
      return project;
    } catch (error) {
      healthUi.bindSession(undefined);
      mirror.dispose();
      try {
        await documents.closeAll();
      } catch (closeError) {
        throw new AggregateError(
          [error, closeError],
          'Playground project binding and document cleanup failed',
        );
      }
      throw error;
    }
  }

  async function transition(
    operation: (app: PlaygroundAppRuntime) => Promise<PlaygroundAppProjectContext | null>,
    instantPreset?: Preset,
  ): Promise<PlaygroundAppProjectContext | null> {
    if (!workbenchReady()) throw new Error('Playground Workbench is not ready');
    if (projectBusy()) throw new Error('Project transition is already running');
    const app = currentRuntime();
    setProjectBusy(true);
    const work = (async () => {
      await disposeBound();
      let context: PlaygroundAppProjectContext | null;
      try {
        context = await operation(app);
      } catch (error) {
        const restored = runtime?.current() ?? null;
        return rebindAfterPlaygroundTransitionFailure(error, restored, async (context) => {
          const project = await bindProject(context);
          await project.typescriptBootReady;
        });
      }
      if (context !== null) await bindProject(context);
      return context;
    })();
    try {
      if (instantPreset?.setup !== 'instant') return await work;
      return await withSlowProgress(work, {
        delayMs: 250,
        onSlow: () => setInstantPrepareLabel(instantPreset.label),
      });
    } finally {
      setInstantPrepareLabel(undefined);
      setProjectBusy(false);
    }
  }

  async function createScratch(starterId: string): Promise<void> {
    try {
      const current = bound()?.context.plan;
      if (current?.id === 'scratch' && current.starterId === starterId && store.dirty()) {
        store.closeLauncher();
        return;
      }
      const preset = presetForId(starterId);
      await transition(
        (app) =>
          app.createScratch(planFor('scratch', starterId), { preserveDirtySameStarter: true }),
        preset,
      );
      store.closeLauncher();
      flashToast(`New scratch from ${preset.label}`, 'success');
    } catch (error) {
      flashError(`Starter open failed: ${errorMessage(error)}`);
    }
  }

  async function activateTarget(id: ActiveId): Promise<void> {
    try {
      if (bound()?.context.plan.id === id) {
        store.closeLauncher();
        return;
      }
      const plan = planForTarget(id);
      await transition((app) => app.activate(plan), presetForId(plan.starterId));
      store.closeLauncher();
    } catch (error) {
      flashError(`Project switch failed: ${errorMessage(error)}`);
    }
  }

  async function initialize(): Promise<void> {
    const workbench = props.workbench;
    if (disposed) {
      await workbenchOwnership.close();
      return;
    }
    healthUi.bindWorkbench(workbench.health);
    latestTerminalState = workbench.playground.restoreTerminalState({
      format:
        props.terminalPersistence.initialStateSource === 'legacy-absolute'
          ? 'legacy-workspace-absolute'
          : 'project-rooted',
      state: props.terminalPersistence.initialState,
    });
    runtime = workbenchOwnership.createRuntime((admittedWorkbench) =>
      createPlaygroundAppRuntime(admittedWorkbench, {
        terminalState: () => latestTerminalState,
      }),
    );
    setStorageMode(workbench.snapshot().storage.backend === 'opfs' ? 'opfs' : 'memory');
    store.setStorage(workbench.snapshot().storage.backend === 'opfs' ? 'opfs' : 'memory');
    unsubscribeCatalog = runtime.catalog.subscribe((snapshot) => {
      const index = catalogIndex(snapshot, hiddenDeleteId);
      store.hydrateIndex(index);
      if (!catalogChoiceReconciled) {
        catalogChoiceReconciled = true;
        reconcileProjectChoiceOnBoot(index, {
          openStarterChoice() {
            store.setLauncherTab('starters');
            store.openLauncher();
          },
          closeProjectChoice: store.closeLauncher,
        });
      } else {
        recordProjectPresenceHint(index);
      }
    });
    setWorkbenchReady(true);
    if (deepLinkStarterId !== undefined) {
      await createScratch(deepLinkStarterId);
      return;
    }
    const plan = activePlan();
    if (plan === null) {
      store.setLauncherTab('starters');
      store.openLauncher();
      return;
    }
    try {
      await bindProject(await runtime.openActive(plan));
    } catch (error) {
      flashError(`Project reopen failed: ${errorMessage(error)}`);
      store.openLauncher();
    }
  }

  function startWorkbench(): void {
    if (initialization !== null) return;
    healthUi.beginBoot();
    setWorkbenchReady(false);
    catalogChoiceReconciled = false;
    const attempt = initialize().catch(async (error: unknown) => {
      setWorkbenchReady(false);
      unsubscribeCatalog?.();
      unsubscribeCatalog = null;
      let trigger = error;
      try {
        await disposeBound();
      } catch (bindingCleanupFailure) {
        trigger = new AggregateError(
          [error, bindingCleanupFailure],
          'Playground App initialization and binding cleanup failed',
        );
      }
      runtime = null;
      try {
        await workbenchOwnership.fail(trigger);
      } catch (failure) {
        healthUi.bootFailed(failure);
        console.error('[playground] Workbench initialization failed', failure);
      }
    });
    initialization = attempt.finally(() => {
      initialization = null;
    });
  }

  function recoverWorkbench(scope: 'scm' | 'preview' | 'persistence'): void {
    void healthUi
      .recover(scope)
      .catch((error: unknown) => flashError(`${scope} recovery failed: ${errorMessage(error)}`));
  }

  function reloadWorkbench(): void {
    if (runtime === null || healthUi.boot().kind === 'boot-failed') {
      globalThis.location?.reload();
      return;
    }
    void runtime.workbench.health
      .recover('reload')
      .catch((error: unknown) => flashError(`Reload failed: ${errorMessage(error)}`));
  }

  async function share(): Promise<void> {
    const copied = await copyToClipboard(globalThis.location?.href ?? '');
    flashToast(
      copied ? 'Link copied — opens this playground' : 'Could not copy the link to the clipboard',
      copied ? 'success' : 'error',
    );
  }

  function openLauncher(): void {
    store.setLauncherTab(
      initialLauncherTab(store.projects().length, loadLauncherTab(browserLocalStorage())),
    );
    store.openLauncher();
  }

  function closeLauncher(): void {
    if (bound() !== undefined) store.closeLauncher();
  }

  function onPickStarter(starterId: string): void {
    const current = bound()?.context.plan;
    // Same-starter re-pick preserves the dirty scratch (createScratch guard +
    // owner preserveDirtySameStarter), so a discard prompt would lie — only a
    // pick that really replaces the draft asks.
    if (store.dirty() && current?.id === 'scratch' && current.starterId !== starterId) {
      store.openDialog({ kind: 'switch', pendingStarter: starterId });
      return;
    }
    void createScratch(starterId);
  }

  function onLauncherSwitch(id: ActiveId): void {
    if (store.dirty() && bound()?.context.plan.id === 'scratch' && id !== 'scratch') {
      store.openDialog({ kind: 'switch', pendingId: id });
      return;
    }
    void activateTarget(id);
  }

  function openSaveDialog(): void {
    const label = presetForId(activeStarterId()).label;
    const defaultName = `${label} project`;
    setSaveName(defaultName);
    store.openDialog({ kind: 'save', defaultName });
  }

  async function confirmSave(): Promise<void> {
    const name = saveName().trim();
    if (name.length === 0 || bound()?.context.plan.id !== 'scratch') return;
    const id = `project-${globalThis.crypto.randomUUID()}`;
    try {
      await transition((app) => app.saveScratch(planFor(id, activeStarterId()), name));
      store.setDialog(null);
      flashToast(
        saveAffordance(storageMode()).ephemeral
          ? `Saved ${name} for this session`
          : `Saved ${name}`,
        'success',
      );
      const pending = pendingSwitch();
      setPendingSwitch(null);
      if (pending?.starterId !== undefined) await createScratch(pending.starterId);
      else if (pending?.projectId !== undefined) await activateTarget(pending.projectId);
    } catch (error) {
      flashError(`Save failed: ${errorMessage(error)}`);
    }
  }

  async function confirmRename(): Promise<void> {
    const dialog = store.dialog();
    const name = renameName().trim();
    if (dialog?.kind !== 'rename' || name.length === 0) return;
    setProjectBusy(true);
    try {
      await currentRuntime().rename(dialog.id, name);
      store.setDialog(null);
      flashToast(`Renamed to ${name}`, 'success');
    } catch (error) {
      flashError(`Rename failed: ${errorMessage(error)}`);
    } finally {
      setProjectBusy(false);
    }
  }

  async function confirmReset(): Promise<void> {
    const dialog = store.dialog();
    if (dialog?.kind !== 'reset') return;
    try {
      const plan = planForTarget(dialog.id);
      await transition((app) => app.reset(plan), presetForId(plan.starterId));
      store.setDialog(null);
      flashToast('Reset to starter', 'success');
    } catch (error) {
      flashError(`Reset failed: ${errorMessage(error)}`);
    }
  }

  const deletePolicy = createDelayedCatalogDelete({
    delayMs: DELETE_GRACE_MS,
    deleteProject: async (id) => void (await transition((app) => app.delete(id))),
    onCommitted() {
      hiddenDeleteId = undefined;
      store.hydrateIndex(catalogIndex(currentRuntime().catalog.snapshot()));
      if (bound() === undefined) store.openLauncher();
    },
    onFailed(_id, error) {
      hiddenDeleteId = undefined;
      store.hydrateIndex(catalogIndex(currentRuntime().catalog.snapshot()));
      flashError(`Delete failed: ${errorMessage(error)}`);
    },
  });

  function confirmDelete(): void {
    const dialog = store.dialog();
    if (dialog?.kind !== 'delete') return;
    deletePolicy.schedule(dialog.id);
    hiddenDeleteId = dialog.id;
    store.confirmDelete();
  }

  function undoDelete(): void {
    if (deletePolicy.undo() === null) return;
    hiddenDeleteId = undefined;
    store.undoDelete();
    if (runtime !== null) store.hydrateIndex(catalogIndex(runtime.catalog.snapshot()));
  }

  function onMenuAction(id: string, action: RowAction): void {
    store.setMenuFor(null);
    if (action === 'switch') {
      onLauncherSwitch(id);
      return;
    }
    const project = store.projects().find((candidate) => candidate.id === id);
    if (project === undefined) return;
    if (action === 'rename') {
      setRenameName(project.name);
      store.openDialog({ kind: 'rename', id, current: project.name });
    } else if (action === 'reset') store.openDialog({ kind: 'reset', id });
    else store.openDialog({ kind: 'delete', id });
  }

  function switchSaveThen(): void {
    const dialog = store.dialog();
    if (dialog?.kind !== 'switch') return;
    setPendingSwitch({
      ...(dialog.pendingStarter === undefined ? {} : { starterId: dialog.pendingStarter }),
      ...(dialog.pendingId === undefined ? {} : { projectId: dialog.pendingId }),
    });
    openSaveDialog();
  }

  function switchDiscardThen(): void {
    const dialog = store.dialog();
    store.setDialog(null);
    if (dialog?.kind !== 'switch') return;
    if (dialog.pendingStarter !== undefined) void createScratch(dialog.pendingStarter);
    else if (dialog.pendingId !== undefined) void activateTarget(dialog.pendingId);
  }

  async function resetBrowserSandbox(): Promise<void> {
    setProjectBusy(true);
    try {
      await disposeBound();
      unsubscribeCatalog?.();
      unsubscribeCatalog = null;
      await workbenchOwnership.close();
      runtime = null;
      const result = await resetBrowserSandboxState();
      if (result.failed.length > 0) {
        throw new Error(
          result.failed.map((failure) => `${failure.name}: ${failure.reason}`).join('; '),
        );
      }
      globalThis.location?.reload();
    } catch (error) {
      flashError(`Sandbox reset failed: ${errorMessage(error)}`);
      setProjectBusy(false);
    }
  }

  function scmChange(row: ScmResourceRow): PlaygroundScmSupportedChange {
    const area = row.side === 'index' ? 'staged' : 'working';
    const change = scmSnapshot().changes.find(
      (candidate): candidate is PlaygroundScmSupportedChange =>
        'code' in candidate &&
        candidate.path === row.path &&
        candidate.code === row.code &&
        candidate.area === area,
    );
    if (change === undefined) throw new Error(`SCM change ${row.path} is stale`);
    return change;
  }

  async function openScmDiff(change: PlaygroundScmSupportedChange): Promise<void> {
    const project = bound();
    if (project === undefined) return;
    try {
      await editorApi?.flushPendingWrites();
      const diff = await project.context.tools.scm.diff(change);
      const presentation = playgroundScmDiffPresentation(
        projectFileName(change.path),
        change,
        diff,
      );
      withProjectEditor(project, (api) =>
        api.openTextDiff({
          id: `scm:${change.area}:${change.path}:${change.code}`,
          path: change.path,
          ...presentation,
          original: decodeText(`${diff.original.source}:${change.path}`, diff.original.bytes),
          modified: decodeText(`${diff.modified.source}:${change.path}`, diff.modified.bytes),
        }),
      );
    } catch (error) {
      if (bound() === project) flashError(`Diff failed: ${errorMessage(error)}`);
    }
  }

  async function compareFiles(left: string, right: string): Promise<void> {
    const project = bound();
    if (project === undefined) return;
    try {
      const [leftBytes, rightBytes] = await Promise.all([
        project.mirror.ensureFile(left),
        project.mirror.ensureFile(right),
      ]);
      withProjectEditor(project, (api) =>
        api.openTextDiff({
          id: `compare:${left}:${right}`,
          path: right,
          title: `${projectFileName(left)} ↔ ${projectFileName(right)}`,
          originalTitle: projectFileName(left),
          modifiedTitle: projectFileName(right),
          original: decodeText(left, leftBytes),
          modified: decodeText(right, rightBytes),
        }),
      );
    } catch (error) {
      if (bound() === project) flashError(`Compare failed: ${errorMessage(error)}`);
    }
  }

  async function compareWorkingFileWithHead(path: string): Promise<void> {
    const project = bound();
    if (project === undefined) return;
    try {
      await editorApi?.flushPendingWrites();
      await project.context.tools.scm.refresh();
      if (bound() !== project) return;
      withProjectEditor(project, (api) => api.openWorkingDiff({ path, ref: 'HEAD' }));
    } catch (error) {
      if (bound() === project) flashError(`Compare failed: ${errorMessage(error)}`);
    }
  }

  async function runScm(
    operation: () => Promise<void>,
    success?: string,
    replacePaths: readonly string[] = [],
  ): Promise<void> {
    const project = bound();
    if (project === undefined) return;
    try {
      await preparePlaygroundOwnerByteOperation({
        editor: editorApi,
        documents: project.documents,
        replacePaths,
      });
      await operation();
      if (success !== undefined) flashToast(success, 'success');
    } catch (error) {
      flashError(`Git operation failed: ${errorMessage(error)}`);
      throw error;
    }
  }

  async function downloadFile(path: string): Promise<void> {
    const project = bound();
    if (project === undefined) return;
    try {
      const bytes = await project.mirror.ensureFile(path);
      downloadBlob(projectFileName(path), new Blob([Uint8Array.from(bytes)]));
    } catch (error) {
      flashError(`Download failed: ${errorMessage(error)}`);
    }
  }

  function archiveBlocked(): boolean {
    return (
      !workbenchReady() ||
      projectBusy() ||
      workbenchUnavailable() ||
      effectiveRunState() !== 'stopped'
    );
  }

  async function exportArchive(): Promise<void> {
    const project = bound();
    if (project === undefined || archiveBlocked()) return;
    try {
      await preparePlaygroundOwnerByteOperation({
        editor: editorApi,
        documents: project.documents,
      });
      const json = await project.context.tools.archive.export();
      downloadBlob(
        `${project.context.plan.id}.rifty.json`,
        new Blob([json], { type: 'application/json' }),
      );
    } catch (error) {
      flashError(`Archive export failed: ${errorMessage(error)}`);
    }
  }

  function chooseArchive(): void {
    if (bound() === undefined || archiveBlocked()) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file === undefined) return;
      void file
        .text()
        .then(async (json) => {
          const project = bound();
          if (project === undefined) return;
          await preparePlaygroundOwnerByteOperation({
            editor: editorApi,
            documents: project.documents,
            replacePaths: ['/'],
          });
          await project.context.tools.archive.import(json);
          flashToast('Workspace archive imported', 'success');
        })
        .catch((error: unknown) => flashError(`Archive import failed: ${errorMessage(error)}`));
    });
    input.click();
  }

  function rememberHistory(record: TerminalHistoryRecord): void {
    const next = addTerminalHistoryRecord(terminalHistory(), record);
    setTerminalHistory(next);
    void props.terminalPersistence.saveHistory(next);
  }

  async function runTerminalLine(id: string, line: string, dims: TerminalDims): Promise<number> {
    const project = bound();
    if (project === undefined) return 1;
    const cwd = terminalSession(project, id).cwd;
    const startedMs = Date.now();
    let exitCode: number | undefined;
    try {
      exitCode = await project.terminal.runLine(id, line, dims);
      return exitCode;
    } catch (error) {
      terminalWriters.get(id)?.(`${errorMessage(error)}\n`, 'stderr');
      exitCode = 1;
      return 1;
    } finally {
      if (bound() === project) persistTerminalSession(project, id);
      if (line.trim().length > 0) {
        const finishedMs = Date.now();
        rememberHistory({
          command: line,
          cwd,
          mode: machine.mode() as TerminalHistoryMode,
          sessionId: id,
          startedAt: new Date(startedMs).toISOString(),
          finishedAt: new Date(finishedMs).toISOString(),
          durationMs: finishedMs - startedMs,
          ...(exitCode === undefined ? {} : { exitCode }),
        });
      }
    }
  }

  function createTerminal(): void {
    const project = bound();
    if (project === undefined) {
      flashError('Open a project before creating a terminal');
      return;
    }
    const created = project.terminal.createSession();
    project.terminal.select(created.id);
    setActiveSessionId(created.id);
    setTerminalFocusEpoch((epoch) => epoch + 1);
  }

  async function stopPrimaryProject(): Promise<void> {
    const project = bound();
    if (project === undefined) return;
    try {
      await project.terminal.stopProject();
    } catch (error) {
      flashError(`Stop failed: ${errorMessage(error)}`);
    }
  }

  function openTerminalLink(uri: string): void {
    const path = pathFromTerminalFileLink(uri, '/');
    if (path !== null) void openEditorFile(path);
  }

  function previewUrl(): string | undefined {
    return previewPorts()[0]?.url;
  }

  function hasPreview(): boolean {
    const plan = bound()?.context.plan;
    return previewPorts().length > 0 || (plan?.kind !== 'node-cli' && runState() === 'starting');
  }

  function openPreviewTab(url = previewPorts()[0]?.url): void {
    if (url === undefined) {
      flashError('Preview is still starting');
      return;
    }
    const popup = globalThis.window?.open('', '_blank');
    if (popup === null || popup === undefined) {
      flashError('Popup blocked — allow popups to open the preview');
      return;
    }
    popup.document.write(
      `<!doctype html><html><head><title>rifty preview</title><style>html,body,iframe{width:100%;height:100%;margin:0;border:0;background:#101218}</style></head><body><iframe src="${url.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></iframe></body></html>`,
    );
    popup.document.close();
  }

  function selectSidebarView(view: 'explorer' | 'scm'): Promise<void> {
    return selectPlaygroundSidebarView(view, {
      currentView: layout.view,
      sidebarCollapsed: layout.sidebarCollapsed,
      flushPendingWrites: () => editorApi?.flushPendingWrites() ?? Promise.resolve(),
      refreshScm: () => bound()?.context.tools.scm.refresh() ?? Promise.resolve(),
      selectView: layout.selectView,
    });
  }

  function paletteItems(): readonly PaletteItem[] {
    const items: PaletteItem[] = PRESETS.map((preset) => ({
      id: `preset:${preset.id}`,
      section: 'Starters',
      label: preset.label,
      hint: preset.blurb,
      icon: preset.icon,
      disabled: projectAdmissionBlocked,
      run: () => onPickStarter(preset.id),
    }));
    for (const path of bound()?.mirror.filePaths() ?? []) {
      items.push({
        id: `file:${path}`,
        section: 'Files',
        label: projectFileName(path),
        hint: path,
        icon: 'file',
        run: () => void openEditorFile(path),
      });
    }
    items.push(
      createSidebarTogglePaletteItem(layout),
      {
        id: 'act:new-terminal',
        section: 'Commands',
        label: 'New terminal',
        icon: 'terminal',
        disabled: () => bound() === undefined,
        run: createTerminal,
      },
      {
        id: 'act:stop-project',
        section: 'Commands',
        label: 'Stop project',
        icon: 'x',
        disabled: () => bound() === undefined || runState() === 'stopped',
        run: () => void stopPrimaryProject(),
      },
      {
        id: 'act:export-workspace',
        section: 'Commands',
        label: 'Download workspace archive',
        icon: 'file-output',
        disabled: archiveBlocked,
        run: () => void exportArchive(),
      },
      {
        id: 'act:import-workspace',
        section: 'Commands',
        label: 'Import workspace archive',
        icon: 'folder-open',
        disabled: archiveBlocked,
        run: chooseArchive,
      },
    );
    return items;
  }

  function openPalette(): void {
    setPaletteData(paletteItems());
    setPaletteOpen(true);
  }

  const terminalModeHint = (): TerminalModeHint => {
    const cwd = sessions().find((session) => session.id === activeSessionId())?.cwd ?? '/';
    return {
      label: 'Shell',
      detail: `Commands run in ${cwd}; running programs own stdin. Use + to open another shell while a program is running.`,
    };
  };

  const livePillLabel = (): string => {
    if (projectBusy()) return 'SWITCHING';
    if (previewPorts()[0] !== undefined) return `LIVE :${String(previewPorts()[0]?.port)}`;
    if (runState() === 'starting') return 'STARTING';
    return runState() === 'running' ? 'RUNNING' : 'STOPPED';
  };

  const livePillState = (): 'stopped' | 'starting' | 'running' | 'switching' => {
    if (projectBusy()) return 'switching';
    return effectiveRunState();
  };

  const modeLabel = (): string => {
    const template = resolveProjectSpec(bound()?.context.plan.templateId ?? 'vite');
    return projectBusy()
      ? `${template.displayName} · switching`
      : previewPorts()[0] === undefined
        ? `${template.displayName} · ${runState()}`
        : `${template.displayName} · port ${String(previewPorts()[0]?.port)}`;
  };

  const dialogTargetName = (): string => {
    const dialog = store.dialog();
    if (dialog?.kind === 'rename' || dialog?.kind === 'delete') {
      return store.projects().find((project) => project.id === dialog.id)?.name ?? dialog.id;
    }
    if (dialog?.kind === 'reset') {
      return dialog.id === 'scratch'
        ? scratchDisplayName(activeGlyph().label)
        : (store.projects().find((project) => project.id === dialog.id)?.name ?? dialog.id);
    }
    return activeName();
  };

  const dialogStarterLabel = (): string => {
    const dialog = store.dialog();
    const id = dialog?.kind === 'reset' ? dialog.id : store.activeId();
    const starter =
      id === 'scratch'
        ? store.scratch()?.starter
        : store.projects().find((project) => project.id === id)?.starter;
    return glyphFor(starter ?? activeStarterId()).label;
  };

  const dialogSwitchDest = (): string => {
    const dialog = store.dialog();
    if (dialog?.kind !== 'switch') return '';
    if (dialog.pendingStarter !== undefined) {
      return `a new ${glyphFor(dialog.pendingStarter).label} scratch`;
    }
    return store.projects().find((project) => project.id === dialog.pendingId)?.name ?? 'project';
  };

  onMount(() => {
    if (capabilities.sufficient) {
      if (
        shouldOpenInstantProjectChoice({
          hasPersistedProject: hasPersistedProjectHint(),
          ...(deepLinkStarterId === undefined ? {} : { requestedStarterId: deepLinkStarterId }),
        })
      ) {
        store.setLauncherTab('starters');
        store.openLauncher();
      }
      startWorkbench();
    }
    const onKey = (event: KeyboardEvent): void => {
      if (
        (event.metaKey || event.ctrlKey) &&
        (event.key.toLowerCase() === 'k' || event.code === 'KeyK')
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (paletteOpen()) setPaletteOpen(false);
        else openPalette();
      } else if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        (event.key.toLowerCase() === 's' || event.code === 'KeyS')
      ) {
        event.preventDefault();
        event.stopPropagation();
        void saveActiveProject();
      } else if (
        (event.metaKey || event.ctrlKey) &&
        (event.key.toLowerCase() === 'w' || event.code === 'KeyW') &&
        editorApi?.closeActiveTab()
      ) {
        event.preventDefault();
        event.stopPropagation();
      } else if (event.key === 'Escape' && !paletteOpen()) {
        if (store.dialog() !== null) {
          setPendingSwitch(null);
          store.setDialog(null);
        } else if (store.launcherOpen()) closeLauncher();
      }
    };
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (healthUi.persistenceAtRisk() || (storageMode() === 'memory' && store.dirty())) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    globalThis.window?.addEventListener('keydown', onKey, true);
    globalThis.window?.addEventListener('beforeunload', onBeforeUnload);
    onCleanup(() => {
      globalThis.window?.removeEventListener('keydown', onKey, true);
      globalThis.window?.removeEventListener('beforeunload', onBeforeUnload);
    });
  });

  onCleanup(() => {
    disposed = true;
    healthUi.dispose();
    deletePolicy.dispose();
    storeToastDismissal.dispose();
    if (toastTimer !== undefined) clearTimeout(toastTimer);
    unsubscribeCatalog?.();
    unsubscribeCatalog = null;
    void (async () => {
      await disposeBound();
      await workbenchOwnership.close();
      runtime = null;
    })().catch((error: unknown) => console.error('[playground] close failed', error));
  });

  return (
    <div
      class="rf-app"
      data-workspace-owner={bound() === undefined ? 'chooser' : 'workspace'}
      data-project-index={workbenchReady() ? 'ready' : 'loading'}
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

      <Show when={capabilities.sufficient}>
        <PlaygroundHealthBanner
          boot={healthUi.boot}
          issues={healthUi.issues}
          onRetry={reloadWorkbench}
          onRecover={recoverWorkbench}
          onReload={reloadWorkbench}
        />
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
          dirty={workspaceAtRisk()}
          onOpen={openLauncher}
        />
        <span class="rf-livepill" data-state={livePillState()} title={modeLabel()}>
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
          <Icon name="users" size={13} /> Share
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
          <SidebarRecoveryAffordance
            collapsed={layout.sidebarCollapsed()}
            onExpand={layout.toggleSidebar}
          />
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
                <Show when={bound()} keyed>
                  {(project) => (
                    <FileExplorer
                      vfs={project.mirror}
                      mutations={project.mutations}
                      root="/"
                      visible={!layout.sidebarCollapsed()}
                      activePath={activeFilePath()}
                      gitStatus={gitStatus()}
                      onOpenFile={(path) => void openEditorFile(path)}
                      onDownloadFile={(path) => void downloadFile(path)}
                      onCompareFiles={(left, right) => void compareFiles(left, right)}
                      onCompareWithHead={(path) => void compareWorkingFileWithHead(path)}
                      onNotify={flashToast}
                    />
                  )}
                </Show>
              }
            >
              <ScmPanel
                root="/"
                branch={scmSnapshot().branch}
                changes={scmSnapshot().changes}
                history={scmSnapshot().history}
                onOpenChange={(row) => void openScmDiff(scmChange(row))}
                onStage={(row) =>
                  runScm(() => bound()?.context.tools.scm.stage(row.path) ?? Promise.resolve())
                }
                onUnstage={(row) =>
                  runScm(() => bound()?.context.tools.scm.unstage(row.path) ?? Promise.resolve())
                }
                onDiscard={(row) => {
                  if (!globalThis.confirm(`Discard changes in ${row.relativePath}?`))
                    return Promise.resolve();
                  return runScm(
                    () => bound()?.context.tools.scm.discard(row.path) ?? Promise.resolve(),
                    undefined,
                    [row.path],
                  );
                }}
                onCommit={(message) =>
                  runScm(
                    async () => void (await bound()?.context.tools.scm.commit(message)),
                    'Committed',
                  )
                }
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
            onInput={layout.setSidebarW}
            onCommit={layout.persist}
            onReset={layout.resetSidebarW}
          />

          <main class="rf-main" data-console={layout.consoleCollapsed() ? 'collapsed' : 'open'}>
            <div class="rf-editorarea" data-preview={hasPreview() ? 'on' : 'off'}>
              {/* Stable first grid child: keeps splitter/preview in tracks 2/3
                  while the lazy editor chunk (or a switch teardown) leaves the
                  editor slot empty — else auto-placement drops the preview into
                  the 12px splitter track. */}
              <div class="rf-editorslot">
                <Show when={bound()} keyed>
                  {(project) => (
                    <EditorHost
                      initialEditorFiles={initialEditorFiles}
                      root={() => '/'}
                      vfs={project.mirror}
                      registerApi={(api) => bindEditor(api, project)}
                      onActive={(info) => {
                        setActiveFile(info.label);
                        setActiveLang(info.language);
                        setActiveFilePath(info.path);
                      }}
                      onFileWritten={(path, content) => {
                        // TODO(backlog: playground/editor-conflict-recovery)
                        return project.documents.write(path, content);
                      }}
                      persistenceAtRisk={healthUi.persistenceAtRisk}
                      readNodeModulesFile={(path) =>
                        readPlaygroundEditorRemoteFile(project.context.session.files, path)
                      }
                      readGitOriginalText={(input) =>
                        readPlaygroundGitOriginalText(
                          project.context.tools.scm,
                          project.mirror,
                          input,
                        )
                      }
                      gitStatus={gitStatus}
                      previewUrl={previewUrl}
                      onOpenPreviewTab={() => openPreviewTab()}
                      onError={flashError}
                    />
                  )}
                </Show>
              </div>
              <Show when={hasPreview()}>
                <Splitter
                  orientation="vertical"
                  value={layout.previewW()}
                  min={layout.bounds.previewW[0]}
                  max={layout.bounds.previewW[1]}
                  defaultValue={464}
                  dir={-1}
                  ariaLabel="Resize preview"
                  onInput={layout.setPreviewW}
                  onCommit={layout.persist}
                  onReset={layout.resetPreviewW}
                />
                <PreviewPanel
                  initialPort={previewPorts()[0]?.port}
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
              onInput={layout.setConsoleH}
              onCommit={layout.persist}
              onReset={layout.resetConsoleH}
            />
            <BottomPanel
              collapsed={layout.consoleCollapsed()}
              sessions={sessions()}
              activeSessionId={activeSessionId()}
              terminalFocusEpoch={terminalFocusEpoch()}
              onToggleCollapse={layout.toggleConsole}
              onSelectSession={(id) => {
                bound()?.terminal.select(id);
                setActiveSessionId(id);
              }}
              onCreateSession={createTerminal}
              onCloseSession={(id) => {
                terminalWriters.delete(id);
                void bound()
                  ?.terminal.closeSession(id)
                  .catch((error: unknown) =>
                    flashError(`Terminal close failed: ${errorMessage(error)}`),
                  );
              }}
              attach={(id, writer) => {
                terminalWriters.set(id, writer);
                bound()?.terminal.attach(id, writer);
              }}
              modeHint={terminalModeHint()}
              historyRecords={terminalHistory}
              completer={(id, line, cursor) => bound()?.terminal.complete(id, line, cursor) ?? null}
              onCompletionError={(error) => flashError(`Completion failed: ${errorMessage(error)}`)}
              onLink={(uri) => openTerminalLink(uri)}
              onSignal={(id) => void bound()?.terminal.stop(id)}
              onRawInput={(id, data) => void bound()?.terminal.write(id, data)}
              onResize={(id, dims) => void bound()?.terminal.resize(id, dims.cols, dims.rows)}
              onLine={runTerminalLine}
              diagnostics={diagnostics()}
              onOpenProblem={(path, line, column) =>
                void openEditorFile(path, { reveal: { line, column } })
              }
            />
          </main>
        </div>

        <Show
          when={degradedBannerVisible({
            storage: storageMode(),
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
          isOpfs={storageMode() === 'opfs'}
          storageMode={storageMode()}
          storagePersisted={
            props.boot.storage.available ? props.boot.storage.persistedAfter : undefined
          }
          storageUsage={props.boot.storage.available ? props.boot.storage.usage : undefined}
          storageQuota={props.boot.storage.available ? props.boot.storage.quota : undefined}
          storageReason={props.boot.storage.error ?? props.boot.vfsBoot.reason}
          coi={isCrossOriginIsolated()}
          activeName={activeName()}
          activeStarter={activeGlyph().label}
          dirty={workspaceAtRisk()}
          onExport={() => void exportArchive()}
          exportDisabled={archiveBlocked()}
          exportTitle={
            archiveBlocked()
              ? 'Stop the project process to archive the workspace'
              : 'Download the editable workspace as a .json archive'
          }
          gitBranch={scmSnapshot().branch}
        />
      </Show>

      <Launcher
        open={store.launcherOpen()}
        tab={store.launcherTab()}
        presets={PRESETS}
        projects={store.projects()}
        scratch={store.scratch()}
        activeId={store.activeId()}
        ownerBlocked={projectAdmissionBlocked()}
        instantPrepareLabel={instantPrepareLabel()}
        storage={store.storage()}
        menuFor={store.menuFor()}
        q={store.q()}
        cat={(store.cat() ?? 'all') as 'all' | StarterGroup}
        glyphFor={glyphFor}
        onTab={(tab) => {
          store.setLauncherTab(tab);
          saveLauncherTab(browserLocalStorage(), tab);
        }}
        onClose={closeLauncher}
        onSearch={store.setQ}
        onCat={store.setCat}
        onPickStarter={onPickStarter}
        onSwitch={onLauncherSwitch}
        onSave={openSaveDialog}
        onMenu={store.setMenuFor}
        onMenuAction={onMenuAction}
        onResetSandbox={() => store.openDialog({ kind: 'reset-sandbox' })}
      />

      <ProjectDialogs
        dialog={store.dialog()}
        ownerBlocked={projectAdmissionBlocked()}
        saveName={saveName()}
        renameName={renameName()}
        targetName={dialogTargetName()}
        starterLabel={dialogStarterLabel()}
        switchDest={dialogSwitchDest()}
        onSaveName={setSaveName}
        onRenameName={setRenameName}
        onCancel={() => {
          setPendingSwitch(null);
          store.setDialog(null);
        }}
        onConfirmSave={() => void confirmSave()}
        onConfirmRename={() => void confirmRename()}
        onConfirmReset={() => void confirmReset()}
        onConfirmDelete={confirmDelete}
        onConfirmResetSandbox={() => void resetBrowserSandbox()}
        onSwitchSaveThen={switchSaveThen}
        onSwitchDiscardThen={switchDiscardThen}
      />

      <Show when={toast()} keyed>
        {(message) => (
          <output class="rf-toast" data-tone={message.tone}>
            <Show when={message.tone === 'success'}>
              <span class="rf-toast__ico" aria-hidden="true">
                <Icon name="check" size={14} />
              </span>
            </Show>
            {message.message}
          </output>
        )}
      </Show>
      <Show when={store.toast()} keyed>
        {(message) => (
          <output class="rf-toast" data-tone={message.kind === 'error' ? 'error' : 'success'}>
            {message.text}
            <Show when={message.undo}>
              <button type="button" class="rf-toast__undo" onClick={undoDelete}>
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
