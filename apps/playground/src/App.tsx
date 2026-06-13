import { globalProcessManager, isSabIpcSupported } from '@riftydev/kernel';
import { RegistryClient } from '@riftydev/npm-client';
import { detectCapabilities } from '@riftydev/runtime-js/env/capabilities';
import type { TerminalRawInput } from '@riftydev/terminal';
import {
  type TerminalHistoryMode,
  type TerminalHistoryRecord,
  addTerminalHistoryRecord,
} from '@riftydev/terminal/history';
import { NotImplementedError, normalizePath, syncMirror } from '@riftydev/vfs';
import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import {
  type TerminalCommand,
  type TerminalCommandContext,
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
import { createBinExecutor } from './glue/bin-executor.ts';
import { copyToClipboard } from './glue/clipboard.ts';
import { readChildren } from './glue/file-tree.ts';
import { writeText } from './glue/fs-ops.ts';
import { NodeModulesCache } from './glue/node-modules-cache.ts';
import { bridgeNodeModulesReads } from './glue/node-modules-port.ts';
import { createNpmShellCommand } from './glue/npm-shell-command.ts';
import { type RealViteHandle, startRealVite } from './glue/realVite.ts';
import { proxiedRegistryFetch } from './glue/registry-fetch.ts';
import { SnapshotFs } from './glue/snapshot-fs.ts';
import { SyncMirrorVfs } from './glue/sync-mirror-vfs.ts';
import { pathFromTerminalFileLink } from './glue/terminal-links.ts';
import type { TerminalPersistence } from './glue/terminal-persistence.ts';
import { subscribeVfsSnapshot } from './glue/vfs-snapshot-port.ts';
import { exportWorkspaceArchive, importWorkspaceArchive } from './glue/workspace-archive.ts';
import { DEFAULT_PRESET, PRESETS, type Preset } from './presets.ts';
import {
  type ProjectSpec,
  buildProjectPackageJson,
  devScriptCommand,
  terminalDevLine,
} from './templates/project-spec.ts';
import { defaultProjectSpec, resolveProjectSpec } from './templates/registry.ts';

const WORKSPACE = '/workspace';

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
  const npmVfs = new SyncMirrorVfs();
  const npmRegistry = new RegistryClient({ fetch: proxiedRegistryFetch() });
  let realViteHandle: RealViteHandle | null = null;

  // Mode state machine owns UI state only. Real server lifetime belongs to the
  // visible `vite` terminal command.
  const machine = useMode({
    sources: { dev: DEFAULT_PRESET.source, realVite: DEFAULT_PRESET.source },
  });

  const [devServerRunning, setDevServerRunning] = createSignal(false);
  const [devServerStatus, setDevServerStatus] = createSignal<'stopped' | 'starting' | 'running'>(
    'stopped',
  );
  let devServerSessionId: string | null = null;
  let devServerRestartGeneration = 0;

  async function runViteCommand(ctx: TerminalCommandContext): Promise<number> {
    const template = activeTemplate();
    // 'vite' keeps its historical terminal tag (e2e-pinned); node servers log as 'dev'.
    const bootTag = template.runtime === 'vite' ? 'vite' : 'dev';
    devServerSessionId = ctx.sessionId;
    ctx.stdout.write(
      template.runtime === 'vite'
        ? 'vite: starting dev server\n'
        : `dev: starting ${template.displayName} server\n`,
    );
    setDevServerStatus('starting');
    if (ctx.signal?.aborted) {
      setDevServerStatus('stopped');
      return 130;
    }
    if (realViteHandle) {
      await realViteHandle.close();
      realViteHandle = null;
      setDevServerRunning(false);
    }

    let handle: RealViteHandle;
    let resolveReady: (() => void) | undefined;
    let readySeen = false;
    const ready = new Promise<'ready'>((resolve) => {
      resolveReady = () => resolve('ready');
    });
    const aborted = new Promise<'aborted'>((resolve) => {
      if (ctx.signal?.aborted) {
        resolve('aborted');
        return;
      }
      ctx.signal?.addEventListener('abort', () => resolve('aborted'), { once: true });
    });
    try {
      handle = await startRealVite({
        template,
        port: machine.realVitePort(),
        onLog: (line) => {
          ctx.stdout.write(line);
          if (line.includes('[real-vite/worker] node_modules read bridge ready')) {
            readySeen = true;
            resolveReady?.();
          }
        },
      });
    } catch (err) {
      ctx.stderr.write(`${bootTag} failed: ${(err as Error).stack ?? (err as Error).message}\n`);
      setDevServerStatus('stopped');
      return 1;
    }

    realViteHandle = handle;
    machine.setRealVitePort(handle.port);
    const closed = handle.closed.then((code) => ({ kind: 'exited' as const, code }));
    const bootResult = readySeen
      ? { kind: 'ready' as const }
      : await Promise.race([
          ready.then(() => ({ kind: 'ready' as const })),
          aborted.then(() => ({ kind: 'aborted' as const })),
          closed,
        ]);
    if (bootResult.kind === 'aborted') {
      if (realViteHandle === handle) realViteHandle = null;
      try {
        await handle.close();
      } catch (err) {
        ctx.stderr.write(`[${bootTag}] cleanup failed: ${(err as Error).message}\n`);
      }
      setDevServerRunning(false);
      setDevServerStatus('stopped');
      ctx.stdout.write(`\n[${bootTag}] stopped\n`);
      return 130;
    }
    if (bootResult.kind === 'exited') {
      if (realViteHandle === handle) realViteHandle = null;
      setDevServerRunning(false);
      setDevServerStatus('stopped');
      ctx.stderr.write(`[${bootTag}] worker exited before the dev server was ready\n`);
      return bootResult.code ?? 1;
    }

    // Once Vite is listening, the worker's preview route can accept file writes.
    // Send dependencies first so the entry never reloads before its imports exist.
    syncPresetFilesToWorker(handle, presetForId(activePreset()));
    handle.updateEntry(machine.source());
    setDevServerRunning(true);
    setDevServerStatus('running');
    ctx.stdout.write(`[${bootTag}] dev server ready on port ${handle.port}\n`);

    const stopResult = await Promise.race([
      aborted.then(() => ({ kind: 'aborted' as const })),
      closed,
    ]);

    if (realViteHandle === handle) realViteHandle = null;
    if (stopResult.kind === 'aborted') {
      try {
        await handle.close();
      } catch (err) {
        ctx.stderr.write(`[${bootTag}] cleanup failed: ${(err as Error).message}\n`);
      }
    }
    setDevServerRunning(false);
    setDevServerStatus('stopped');
    if (stopResult.kind === 'aborted') {
      ctx.stdout.write(`\n[${bootTag}] stopped\n`);
      return 130;
    }
    ctx.stderr.write(`\n[${bootTag}] worker exited\n`);
    return stopResult.code ?? 1;
  }

  async function runTerminalScript(
    scriptName: string,
    command: string,
    ctx: TerminalCommandContext,
  ): Promise<number> {
    if (command.trim() === 'vite') return runViteCommand(ctx);
    // The active template's own dev script (e.g. `node src/main.js`) routes to
    // the SAME lifecycle-owning command, so `npm run dev` boots node servers.
    if (command.trim() === devScriptCommand(activeTemplate())) return runViteCommand(ctx);
    ctx.stderr.write(`npm: script '${scriptName}' uses unsupported command '${command}'\n`);
    return 1;
  }

  const npmCommand: TerminalCommand = async (args, ctx) =>
    createNpmShellCommand({
      vfs: npmVfs,
      registry: npmRegistry,
      runScript: async (scriptName, command) => runTerminalScript(scriptName, command, ctx),
    })(args, ctx);

  const viteCommand: TerminalCommand = async (args, ctx) => {
    if (args.length > 0) {
      ctx.stderr.write(
        `vite: arguments are not supported in the playground yet: ${args.join(' ')}\n`,
      );
      return 1;
    }
    const template = activeTemplate();
    if (template.runtime !== 'vite') {
      ctx.stderr.write(
        `vite: the active project is ${template.displayName}; run \`${terminalDevLine(template, WORKSPACE)}\` instead\n`,
      );
      return 1;
    }
    return runViteCommand(ctx);
  };

  // Runs a shell-resolved `node_modules/.bin/<name>` shim as a Node entry
  // (ADR-0137). The shell resolves the bare name; this spawns the shim in a
  // kernel Worker, so `eslint` / `tsc` / any installed CLI is invokable by name.
  // Registered commands (`vite`) still win — the playground owns that lifecycle.
  const terminalBinExecutor = createBinExecutor({
    readShim: (binPath) => {
      const fs = syncMirror();
      return fs.statSyncOrNull(binPath)?.isFile ? fs.readFileBytesSync(binPath) : null;
    },
    spawn: (spec) => {
      if (!isSabIpcSupported()) {
        throw new NotImplementedError(
          'shell.bin-exec',
          'running an installed CLI needs SAB IPC (cross-origin isolation)',
        );
      }
      const handle = globalProcessManager.spawnWorker(
        spec.argv[1] ?? 'bin',
        {
          entry: { kind: 'source', code: spec.code, sourceUrl: spec.sourceUrl },
          argv: [...spec.argv],
          env: spec.env,
          cwd: spec.cwd,
        },
        /* ppid */ 1,
        { cwd: spec.cwd },
      );
      if (handle.kind !== 'worker') {
        throw new NotImplementedError(
          'shell.bin-exec',
          `spawnWorker returned kind=${handle.kind}; expected 'worker'`,
        );
      }
      return handle;
    },
  });

  const manager = createTerminalManager({
    cwd: props.terminalPersistence.initialState.cwd,
    env: props.terminalPersistence.initialState.env,
    commands: { npm: npmCommand, vite: viteCommand },
    execBin: terminalBinExecutor,
  });
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
    const run = manager.runLine(id, line, dims);
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
    const run = manager.runSequence(id, lines, dims);
    refreshTerminalState();
    try {
      await run;
    } catch (err) {
      console.error(err);
    } finally {
      refreshTerminalState();
    }
  }

  function stopSession(id: string): void {
    manager.stop(id);
    refreshTerminalState();
  }

  function writeTerminalStdin(id: string, data: TerminalRawInput): void {
    manager.writeStdin(id, data);
  }

  // Worker project's node_modules presence (ADR-0080): snapshot excludes its
  // contents but flags presence, gating the lazy row.
  const [nodeModulesPresent, setNodeModulesPresent] = createSignal(false);

  // Subscribe while the worker is starting/running so we do not miss its early
  // snapshot frames, but only render that mirror once Vite is actually ready.
  createEffect(() => {
    if (devServerStatus() === 'stopped') {
      snapshotFs.clear();
      setNodeModulesPresent(false);
      return;
    }
    const unsubscribe = subscribeVfsSnapshot(machine.realVitePort(), (frame) => {
      snapshotFs.update(frame);
      setNodeModulesPresent(frame.nodeModulesPresent);
    });
    onCleanup(unsubscribe);
  });

  // Lazy node_modules read bridge + cache (ADR-0080), scoped to one worker
  // on-cycle. The UI only exposes it once the worker server is ready.
  const [nmCache, setNmCache] = createSignal<NodeModulesCache | null>(null);
  createEffect(() => {
    if (devServerStatus() === 'stopped') {
      setNmCache(null);
      return;
    }
    const cache = new NodeModulesCache(bridgeNodeModulesReads(machine.realVitePort()));
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

  function syncPresetFilesToWorker(handle: RealViteHandle | null, preset: Preset): void {
    if (!handle) return;
    for (const file of preset.files ?? []) {
      handle.updateFile(workspacePresetPath(file.path), file.content);
    }
  }

  function openPresetEditorTabs(preset: Preset): void {
    for (const path of preset.openFiles ?? []) {
      editorApi?.openFile(workspacePresetPath(path), { activate: false });
    }
  }

  function syncWorkspaceFileToWorker(path: string): void {
    const handle = realViteHandle;
    if (!handle || path === PROGRAM_MIRROR_PATH) return;
    try {
      handle.updateFile(path, new TextDecoder().decode(vfs.readFileBytesSync(path)));
    } catch {
      /* best-effort live sync for opened text files */
    }
  }

  function seedViteWorkspace(preset: Preset): void {
    const packageJson = buildProjectPackageJson(activeTemplate()).json;
    writeText(vfs, `${WORKSPACE}/package.json`, packageJson);
    writeText(vfs, PROGRAM_MIRROR_PATH, preset.source);
    seedPresetFiles(preset);
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
    try {
      await realViteHandle?.close();
    } catch {
      /* terminal command will surface the exit path */
    }
    await waitForDevServerStop();
    if (generation !== devServerRestartGeneration) return;
    const targetSessionId = isVisibleTerminalSession(sessionId) ? sessionId : devServerSession().id;
    devServerSessionId = targetSessionId;
    await runTerminalSequence(targetSessionId, [terminalDevLine(activeTemplate(), WORKSPACE)]);
  }

  async function runVitePreset(preset: Preset): Promise<void> {
    setActivePreset(preset.id);
    await machine.loadPreset(preset);
    seedViteWorkspace(preset);
    openPresetEditorTabs(preset);
    syncPresetFilesToWorker(realViteHandle, preset);
    realViteHandle?.updateEntry(preset.source);
    if (devServerStatus() !== 'stopped') {
      const restartSessionId = devServerSessionId;
      if (restartSessionId) void restartDevServer(restartSessionId);
      return;
    }
    const session = devServerSession();
    devServerSessionId = session.id;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await runTerminalSequence(session.id, [terminalDevLine(activeTemplate(), WORKSPACE)]);
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
    void realViteHandle?.close();
    manager.dispose();
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
    realViteHandle?.updateEntry(next);
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
                onFileWritten={syncWorkspaceFileToWorker}
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
