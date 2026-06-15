import { isSabIpcSupported } from '@riftydev/kernel';
import { detectCapabilities } from '@riftydev/runtime-js/env/capabilities';
import type { TerminalRawInput } from '@riftydev/terminal';
import {
  type TerminalHistoryMode,
  type TerminalHistoryRecord,
  addTerminalHistoryRecord,
} from '@riftydev/terminal/history';
import { normalizePath, syncMirror } from '@riftydev/vfs';
import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
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
import { type EditorApi, EditorHost, PROGRAM_MIRROR_PATH } from './components/EditorHost.tsx';
import { FileExplorer } from './components/FileExplorer.tsx';
import { PreviewPanel } from './components/PreviewPanel.tsx';
import { Splitter } from './components/Splitter.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { TemplateSwitcher } from './components/TemplateSwitcher.tsx';
import type { TerminalModeHint } from './components/TerminalPanel.tsx';
import { Icon } from './components/icons.tsx';
import { copyToClipboard } from './glue/clipboard.ts';
import { readChildren } from './glue/file-tree.ts';
import { writeText } from './glue/fs-ops.ts';
import { NodeModulesCache } from './glue/node-modules-cache.ts';
import { bridgeNodeModulesReads } from './glue/node-modules-port.ts';
import {
  type WorkspaceOwnerHandle,
  startWorkspaceOwner,
  wirePreviewBridge,
} from './glue/realVite.ts';
import { SnapshotFs } from './glue/snapshot-fs.ts';
import { pathFromTerminalFileLink } from './glue/terminal-links.ts';
import type { TerminalPersistence } from './glue/terminal-persistence.ts';
import { requestVfsSnapshot, subscribeVfsSnapshot } from './glue/vfs-snapshot-port.ts';
import { exportWorkspaceArchive, importWorkspaceArchive } from './glue/workspace-archive.ts';
import { DEFAULT_PRESET, PRESETS, type Preset, presetBootLines } from './presets.ts';
import { type ProjectSpec, buildProjectPackageJson } from './templates/project-spec.ts';
import { defaultProjectSpec, resolveProjectSpec } from './templates/registry.ts';

const WORKSPACE = '/workspace';

/** BroadcastChannel key the unavailable-owner stub reports; never served. */
const UNAVAILABLE_OWNER_PORT = -1;
const OWNER_UNAVAILABLE_MSG =
  'shell needs cross-origin isolation (SAB IPC) — serve the playground with COOP/COEP headers (vite.config.ts ships them)\n';

/**
 * Fail-loud {@link WorkspaceOwnerHandle} for a non-isolated host (ADR-0146:
 * no PAGE shell fallback under D). `openSession` resolves so the terminal
 * manager never hangs; `exec` writes the requirement to stderr and exits 1.
 * No worker is spawned and no bridges are served.
 */
function createUnavailableOwner(): WorkspaceOwnerHandle {
  return {
    workspaceId: 'unavailable',
    previewOwnerToken: 'unavailable',
    snapshotPort: UNAVAILABLE_OWNER_PORT,
    closed: Promise.resolve(0),
    openSession: () => Promise.resolve(),
    exec: (_sid, _line, opts) => {
      opts.onChunk(OWNER_UNAVAILABLE_MSG, 'stderr');
      return Promise.resolve(1);
    },
    writeStdin: () => {},
    signal: () => {},
    resize: () => {},
    closeSession: () => {},
    writeFile: () => {},
    snapshot: () => ({ cwd: WORKSPACE, env: {} }),
    onDevServer: () => () => {},
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
  const [activePreset, setActivePreset] = createSignal(DEFAULT_PRESET.id);
  const [activeFile, setActiveFile] = createSignal('main.js');
  const [activeFilePath, setActiveFilePath] = createSignal<string | undefined>(undefined);
  const [activeLang, setActiveLang] = createSignal('javascript');
  const [toast, setToast] = createSignal<{ message: string; tone: 'error' | 'success' } | null>(
    null,
  );
  const [paletteOpen, setPaletteOpen] = createSignal(false);

  const layout = useLayout();
  // Main-thread sync VFS mirror — same store the shell + `npm install` write to,
  // so the explorer is honest (ADR-0075). Stable after bootstrap's initBackend().
  const vfs = syncMirror();

  // Read-only mirror of the real-vite worker's project tree (ADR-0076). The
  // worker's VFS is a separate realm the page can't read directly, so it
  // publishes its tree (sans node_modules) over a BroadcastChannel; applied here.
  const snapshotFs = new SnapshotFs(WORKSPACE);

  let editorApi: EditorApi | undefined;
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
    if (copied) flashToast(`Link copied — ${globalThis.location?.host ?? url}`, 'success');
    else flashToast('Could not copy the link to the clipboard', 'error');
  }

  function workspaceArchiveBlocked(): boolean {
    return devServerStatus() !== 'stopped';
  }

  function downloadWorkspaceArchive(): void {
    if (workspaceArchiveBlocked()) {
      flashError('Stop the dev server to archive the editable workspace');
      return;
    }
    const doc = globalThis.document;
    if (!doc) {
      flashError('Workspace archive download is unavailable here');
      return;
    }
    const archive = exportWorkspaceArchive(vfs, WORKSPACE);
    const blob = new Blob([archive], { type: 'application/vnd.rifty.workspace+json' });
    const url = URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = 'rifty-workspace.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    flashToast('Workspace archive downloaded', 'success');
  }

  async function importWorkspaceArchiveFile(file: File): Promise<void> {
    try {
      importWorkspaceArchive(vfs, await file.text(), { root: WORKSPACE });
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

  // Active real-project template (ADR-0078): follows the selected preset's
  // templateId, so a node-server preset boots ITS worker runtime, not the
  // registry default. Chip + mode machine read its generic display name.
  const activeTemplate = (): ProjectSpec => {
    const preset = presetForId(activePreset());
    return preset.templateId ? resolveProjectSpec(preset.templateId) : defaultProjectSpec();
  };

  // Persistent workspace owner (ADR-0146 P2 + ADR-0148 P4): hosts the resident
  // `Shell` per session + cwd/env + the CO-RESIDENT dev server, runs `npm install`
  // + bin/`execSync` + `vite` in-realm against ITS `syncMirror()` — the one store
  // the explorer/editor read over the snapshot/nm bridges. Spawned once at setup,
  // killed on cleanup. Gated on SAB IPC: under D there is no PAGE shell fallback,
  // so a non-isolated host gets a fail-loud stub owner that surfaces the
  // requirement per command (rather than crashing the app tree at setup).
  const workspaceOwner: WorkspaceOwnerHandle = isSabIpcSupported()
    ? startWorkspaceOwner({
        root: WORKSPACE,
        template: activeTemplate(),
        slug: activePreset(),
        setup: presetForId(activePreset()).setup,
        onLog: (line) => console.info(line),
      })
    : createUnavailableOwner();

  // Mode state machine owns UI state only. Real server lifetime belongs to the
  // visible `vite` terminal command.
  const machine = useMode({
    sources: { dev: DEFAULT_PRESET.source, realVite: DEFAULT_PRESET.source },
  });

  // Dev-server lifecycle is OWNER-driven now (ADR-0148 P4): the `vite` / `npm run
  // dev` line runs in the owner over the pty channel; the owner reports
  // start/stop + the listen port via `pty:dev-server` frames. The page only
  // mirrors that state + (un)wires the preview SW route.
  const [devServerStatus, setDevServerStatus] = createSignal<'stopped' | 'starting' | 'running'>(
    'stopped',
  );
  const devServerRunning = (): boolean => devServerStatus() === 'running';
  let devServerSessionId: string | null = null;
  let devServerRestartGeneration = 0;

  // Mirror the owner's dev-server state + wire the page-side preview SW route on
  // the reported port (ADR-0148 P4). The owner serves `/preview/<port>/`; the
  // page only (un)registers the matching cross-realm bridge on start/stop.
  createEffect(() => {
    let tearPreview: (() => void) | undefined;
    const unsubscribe = workspaceOwner.onDevServer((frame) => {
      setDevServerStatus(frame.status);
      if (frame.port !== undefined) machine.setRealVitePort(frame.port);
      tearPreview?.();
      tearPreview =
        frame.status === 'running' && frame.port !== undefined
          ? wirePreviewBridge(frame.port, workspaceOwner.previewOwnerToken)
          : undefined;
    });
    onCleanup(() => {
      tearPreview?.();
      unsubscribe();
    });
  });

  // The terminal shell + cwd/env + npm + bin all live in the persistent
  // workspace owner now (ADR-0146 P2); the manager is a thin pty-channel client.
  const manager = createTerminalManager({
    owner: workspaceOwner,
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
    // The dev server runs IN the owner now (ADR-0148 P4), as an ordinary
    // long-running `manager.runLine` — its session reports `running` natively,
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
    return session;
  }

  function closeSession(id: string): void {
    const session = manager.snapshot(id);
    if (session.status === 'running') return;
    hiddenSessionIds.add(id);
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
   * Run one terminal line in the owner shell over the pty channel (ADR-0148 P4):
   * EVERY line — including the dev-server `vite` / `npm run dev` — runs in the
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
    // P4); forward the cooperative SIGINT (Ctrl-C aborts the in-flight run).
    manager.stop(id);
    refreshTerminalState();
  }

  function writeTerminalStdin(id: string, data: TerminalRawInput): void {
    manager.writeStdin(id, data);
  }

  // Worker project's node_modules presence (ADR-0080): snapshot excludes its
  // contents but flags presence, gating the lazy row.
  const [nodeModulesPresent, setNodeModulesPresent] = createSignal(false);

  // ADR-0146 P2 + ADR-0148 P4: the snapshot + node_modules bridges are served by
  // the PERSISTENT workspace owner (which now also runs the dev server), so the
  // explorer reflects the owner tree (where `npm install` lands) before AND after
  // any vite run. Subscribed once at setup (no signal dependency), torn on unmount.
  createEffect(() => {
    const unsubscribe = subscribeVfsSnapshot(workspaceOwner.snapshotPort, (frame) => {
      snapshotFs.update(frame);
      setNodeModulesPresent(frame.nodeModulesPresent);
    });
    // Readiness handshake (ADR-0146 P3): ask the owner to publish now — covers
    // the case where the owner came up before this subscription (its startup
    // publish would have been missed), replacing the owner-side retry-storm.
    requestVfsSnapshot(workspaceOwner.snapshotPort);
    onCleanup(unsubscribe);
  });

  // Lazy node_modules read bridge + cache (ADR-0080), against the persistent
  // owner. Available for the whole session (the owner serves it on `serve:true`).
  const [nmCache, setNmCache] = createSignal<NodeModulesCache | null>(null);
  createEffect(() => {
    const cache = new NodeModulesCache(bridgeNodeModulesReads(workspaceOwner.snapshotPort));
    setNmCache(cache);
    onCleanup(() => {
      cache.dispose();
      setNmCache(null);
    });
  });

  /** Prop bundle for the real-vite explorer's lazy node_modules branch. */
  const nodeModulesProp = ():
    | { cache: NodeModulesCache; present: boolean; root: string }
    | undefined => {
    const cache = nmCache();
    return cache ? { cache, present: nodeModulesPresent(), root: WORKSPACE } : undefined;
  };
  /** Async node_modules file reader for the editor (real-vite only). */
  const readNodeModulesFile = ():
    | ((path: string) => Promise<{ size: number; content: Uint8Array | null }>)
    | undefined => {
    const cache = nmCache();
    return cache ? (path: string) => cache.readFile(path) : undefined;
  };

  // Explorer + editor read the worker mirror only once `vite` is really up;
  // during install/start/stop they stay on the writable workspace mirror.
  const activeVfs = () => (devServerRunning() ? snapshotFs : vfs);
  let initialRunTimer: ReturnType<typeof setTimeout> | undefined;

  function presetForId(id: string): Preset {
    return PRESETS.find((preset) => preset.id === id) ?? DEFAULT_PRESET;
  }

  function workspacePresetPath(path: string): string {
    const normalized = normalizePath(`${WORKSPACE}/${path.replace(/^\/+/, '')}`);
    if (normalized === WORKSPACE || !normalized.startsWith(`${WORKSPACE}/`)) {
      throw new Error(`Preset file escapes workspace: ${path}`);
    }
    return normalized;
  }

  function seedPresetFiles(preset: Preset): void {
    for (const file of preset.files ?? []) {
      writeText(vfs, workspacePresetPath(file.path), file.content);
    }
  }

  function openPresetEditorTabs(preset: Preset): void {
    for (const path of preset.openFiles ?? []) {
      editorApi?.openFile(workspacePresetPath(path), { activate: false });
    }
  }

  // SSoT (ADR-0148 P4): editor writes flow to the OWNER (the execution truth), so
  // the co-resident dev server (HMR) + shell see them. The page `vfs` is the
  // editor's sync working copy; the program tab flows via `onProgramChange`.
  function syncWorkspaceFileToOwner(path: string): void {
    if (path === PROGRAM_MIRROR_PATH) return;
    try {
      workspaceOwner.writeFile(path, new TextDecoder().decode(vfs.readFileBytesSync(path)));
    } catch {
      /* best-effort live sync for opened text files */
    }
  }

  /**
   * Push the project files into the persistent owner realm (ADR-0146 P2). The
   * owner-resident shell reads its OWN `syncMirror()`, seeded from the template
   * only — without this the shell `cat`/`ls` miss preset files (project-summary
   * etc.) and the editor source. Entry source + preset files only; the owner's
   * own template package.json stands. P3 makes the owner the single writer.
   */
  function seedWorkspaceOwner(preset: Preset): void {
    workspaceOwner.writeFile(PROGRAM_MIRROR_PATH, preset.source);
    for (const file of preset.files ?? []) {
      workspaceOwner.writeFile(workspacePresetPath(file.path), file.content);
    }
  }

  function seedViteWorkspace(preset: Preset): void {
    const packageJson = buildProjectPackageJson(activeTemplate()).json;
    writeText(vfs, `${WORKSPACE}/package.json`, packageJson);
    writeText(vfs, PROGRAM_MIRROR_PATH, preset.source);
    seedPresetFiles(preset);
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

  async function restartDevServer(sessionId: string): Promise<void> {
    const generation = ++devServerRestartGeneration;
    // Stop the running dev command in its session (ADR-0148 P4): the owner aborts
    // the run → the co-resident dev server stops → `devServerStatus` → 'stopped'.
    if (devServerSessionId) manager.stop(devServerSessionId);
    await waitForDevServerStop();
    if (generation !== devServerRestartGeneration) return;
    const targetSessionId = isVisibleTerminalSession(sessionId) ? sessionId : devServerSession().id;
    devServerSessionId = targetSessionId;
    manager.clear(targetSessionId); // fresh console for the switched-in project
    await runTerminalSequence(
      targetSessionId,
      presetBootLines(presetForId(activePreset()), WORKSPACE),
    );
  }

  async function runVitePreset(preset: Preset): Promise<void> {
    setActivePreset(preset.id);
    await machine.loadPreset(preset);
    seedViteWorkspace(preset);
    openPresetEditorTabs(preset);
    if (devServerStatus() !== 'stopped') {
      const restartSessionId = devServerSessionId;
      if (restartSessionId) void restartDevServer(restartSessionId);
      return;
    }
    const session = devServerSession();
    devServerSessionId = session.id;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    manager.clear(session.id); // fresh console for the switched-in project
    await runTerminalSequence(session.id, presetBootLines(preset, WORKSPACE));
  }

  onMount(() => {
    // Seed the workspace (idempotent).
    try {
      seedViteWorkspace(DEFAULT_PRESET);
      if (!vfs.existsSync(`${WORKSPACE}/README.md`)) {
        writeText(
          vfs,
          `${WORKSPACE}/README.md`,
          '# workspace\n\nThis is the in-browser virtual filesystem.\n\n- Edit the program in the `src/main.js` tab.\n- Run `npm install <pkg>` in any terminal; installs land in `node_modules`.\n',
        );
      }
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
    manager.dispose();
    workspaceOwner.close(); // terminate the persistent owner worker (ADR-0146)
  });

  function onSelectPreset(preset: Preset): void {
    void runVitePreset(preset);
  }

  const previewUrl = (port = machine.realVitePort()): string | undefined =>
    devServerRunning() ? `/preview/${port}/` : undefined;

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
    // SSoT (ADR-0148 P4): push the program edit to the owner so the co-resident
    // dev server HMR-updates (the program mirror is the entry vite serves).
    workspaceOwner.writeFile(PROGRAM_MIRROR_PATH, next);
  }

  function onTerminalLink(uri: string): void {
    const path = pathFromTerminalFileLink(uri, WORKSPACE);
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
    const out: string[] = [];
    let truncated = false;
    const tree = activeVfs();
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
    walkDir(WORKSPACE);
    return { files: out, truncated };
  }

  function paletteItems(): PaletteItem[] {
    const items: PaletteItem[] = [];
    for (const preset of PRESETS) {
      items.push({
        id: `tpl:${preset.id}`,
        section: 'Templates',
        label: preset.label,
        hint: preset.id,
        icon: 'layers',
        run: () => void runVitePreset(preset),
      });
    }
    const workspace = listWorkspaceFiles();
    for (const path of workspace.files) {
      items.push({
        id: `file:${path}`,
        section: 'Files',
        label: path.startsWith(`${WORKSPACE}/`) ? path.slice(WORKSPACE.length + 1) : path,
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
      run: () => downloadWorkspaceArchive(),
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
    detail: 'Commands run in /workspace; running programs own stdin.',
  });
  const programTitle = (): string => activeTemplate().entry.relativePath.replace(/^\/+/, '');
  const hasPreview = (): boolean => devServerStatus() !== 'stopped';
  const isOpfs = props.boot.vfsBoot.backend === 'opfs';

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

        <TemplateSwitcher activeId={activePreset()} onSelect={onSelectPreset} />

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
            {/* real-vite swaps the explorer's backing store. FileExplorer
                captures `vfs` once, so the mode flip must remount it —
                Show/fallback does exactly that. */}
            <Show
              when={devServerRunning()}
              fallback={
                <FileExplorer
                  vfs={vfs}
                  root={WORKSPACE}
                  visible={!layout.sidebarCollapsed()}
                  activePath={activeFilePath()}
                  onOpenFile={(path) => editorApi?.openFile(path)}
                  onError={flashError}
                />
              }
            >
              <FileExplorer
                vfs={snapshotFs}
                root={WORKSPACE}
                readOnly
                nodeModules={nodeModulesProp()}
                visible={!layout.sidebarCollapsed()}
                activePath={activeFilePath()}
                onOpenFile={(path) => editorApi?.openFile(path)}
                onError={flashError}
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
              <EditorHost
                programValue={machine.source}
                programTitle={programTitle}
                onProgramChange={onProgramChange}
                vfs={activeVfs()}
                registerApi={(api) => {
                  editorApi = api;
                }}
                onActive={(info) => {
                  setActiveFile(info.label);
                  setActiveLang(info.language);
                  setActiveFilePath(info.path);
                }}
                onFileWritten={syncWorkspaceFileToOwner}
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
              <Show when={hasPreview() ? machine.realVitePort() : false} keyed>
                {(port) => (
                  <PreviewPanel
                    initialPort={port}
                    onOpenTab={openPreviewTab}
                    onNotify={flashToast}
                  />
                )}
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
            />
          </main>
        </div>

        <StatusBar
          mode={machine.mode()}
          modeLabel={modeLabel()}
          activeFile={activeFile()}
          language={activeLang()}
          isOpfs={isOpfs}
          storagePersisted={
            props.boot.storage.available ? props.boot.storage.persistedAfter : undefined
          }
          storageUsage={props.boot.storage.available ? props.boot.storage.usage : undefined}
          storageQuota={props.boot.storage.available ? props.boot.storage.quota : undefined}
          storageReason={props.boot.storage.error ?? props.boot.vfsBoot.reason}
          coi={isCrossOriginIsolated()}
        />
      </Show>

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

      <CommandPalette
        open={paletteOpen()}
        items={paletteData()}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}
