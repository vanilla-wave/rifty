import { RegistryClient } from '@riftydev/npm-client';
import { detectCapabilities } from '@riftydev/runtime-js/env/capabilities';
import {
  type TerminalHistoryMode,
  type TerminalHistoryRecord,
  addTerminalHistoryRecord,
} from '@riftydev/terminal/history';
import { normalizePath, syncMirror } from '@riftydev/vfs';
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
import { ActivityBar } from './components/ActivityBar.tsx';
import { BottomPanel } from './components/BottomPanel.tsx';
import { CapabilitiesPanel } from './components/CapabilitiesPanel.tsx';
import { type EditorApi, EditorHost, PROGRAM_MIRROR_PATH } from './components/EditorHost.tsx';
import { FileExplorer } from './components/FileExplorer.tsx';
import { PresetGallery } from './components/PresetGallery.tsx';
import { PreviewPanel } from './components/PreviewPanel.tsx';
import { Splitter } from './components/Splitter.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import type { TerminalModeHint } from './components/TerminalPanel.tsx';
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
import { DEFAULT_PRESET, PRESETS, type Preset } from './presets.ts';
import { buildProjectPackageJson } from './templates/project-spec.ts';
import { defaultProjectSpec } from './templates/registry.ts';

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
  const [toast, setToast] = createSignal<string | null>(null);

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
  function flashError(message: string): void {
    setToast(message);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToast(null), 3800);
  }

  // Active real-project template (ADR-0078). Chip + mode machine read its generic
  // display name instead of "Real Vite".
  const template = defaultProjectSpec();
  const npmInstall = createNpmShellCommand({
    vfs: new SyncMirrorVfs(),
    registry: new RegistryClient({ fetch: proxiedRegistryFetch() }),
  });
  let realViteHandle: RealViteHandle | null = null;

  // Mode state machine owns UI state only. Real server lifetime belongs to the
  // visible `vite` terminal command.
  const machine = useMode({
    sources: { dev: DEFAULT_PRESET.source, realVite: DEFAULT_PRESET.source },
  });

  const [devServerRunning, setDevServerRunning] = createSignal(false);
  const [previewRevision, setPreviewRevision] = createSignal(0);
  const [devServerStatus, setDevServerStatus] = createSignal<'stopped' | 'starting' | 'running'>(
    'stopped',
  );
  let devServerSessionId: string | null = null;
  let devServerRestartGeneration = 0;

  async function runViteCommand(ctx: TerminalCommandContext): Promise<number> {
    devServerSessionId = ctx.sessionId;
    ctx.stdout.write('vite: starting dev server\n');
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
      ctx.stderr.write(`vite failed: ${(err as Error).stack ?? (err as Error).message}\n`);
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
        ctx.stderr.write(`[vite] cleanup failed: ${(err as Error).message}\n`);
      }
      setDevServerRunning(false);
      setDevServerStatus('stopped');
      ctx.stdout.write('\n[vite] stopped\n');
      return 130;
    }
    if (bootResult.kind === 'exited') {
      if (realViteHandle === handle) realViteHandle = null;
      setDevServerRunning(false);
      setDevServerStatus('stopped');
      ctx.stderr.write('[vite] worker exited before the dev server was ready\n');
      return bootResult.code ?? 1;
    }

    // Once Vite is listening, the worker's preview route can accept file writes.
    // Send dependencies first so the entry never reloads before its imports exist.
    syncPresetFilesToWorker(handle, presetForId(activePreset()));
    handle.updateEntry(machine.source());
    setDevServerRunning(true);
    setDevServerStatus('running');
    ctx.stdout.write(`[vite] dev server ready on port ${handle.port}\n`);

    const stopResult = await Promise.race([
      aborted.then(() => ({ kind: 'aborted' as const })),
      closed,
    ]);

    if (realViteHandle === handle) realViteHandle = null;
    if (stopResult.kind === 'aborted') {
      try {
        await handle.close();
      } catch (err) {
        ctx.stderr.write(`[vite] cleanup failed: ${(err as Error).message}\n`);
      }
    }
    setDevServerRunning(false);
    setDevServerStatus('stopped');
    if (stopResult.kind === 'aborted') {
      ctx.stdout.write('\n[vite] stopped\n');
      return 130;
    }
    ctx.stderr.write('\n[vite] worker exited\n');
    return stopResult.code ?? 1;
  }

  const npmCommand: TerminalCommand = async (args, ctx) => npmInstall(args, ctx);

  const viteCommand: TerminalCommand = async (args, ctx) => {
    if (args.length > 0) {
      ctx.stderr.write(
        `vite: arguments are not supported in the playground yet: ${args.join(' ')}\n`,
      );
      return 1;
    }
    return runViteCommand(ctx);
  };

  const manager = createTerminalManager({
    cwd: props.terminalPersistence.initialState.cwd,
    commands: { npm: npmCommand, vite: viteCommand },
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
    void props.terminalPersistence.saveState({ cwd: session.cwd, env: {} });
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

  // Worker project's node_modules presence (ADR-0080): snapshot excludes its
  // contents but flags presence, gating the lazy row.
  const [nodeModulesPresent, setNodeModulesPresent] = createSignal(false);

  // Subscribe while the worker is starting/running so we do not miss its early
  // snapshot frames, but only render that mirror once Vite is actually ready.
  createEffect(() => {
    if (devServerStatus() === 'stopped') {
      snapshotFs.clear();
      setNodeModulesPresent(false);
      setPreviewRevision(0);
      return;
    }
    const unsubscribe = subscribeVfsSnapshot(machine.realVitePort(), (frame) => {
      snapshotFs.update(frame);
      setNodeModulesPresent(frame.nodeModulesPresent);
      setPreviewRevision((n) => n + 1);
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
    const packageJson = buildProjectPackageJson(template).json;
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
    devServerSessionId = sessionId;
    await runTerminalSequence(sessionId, ['vite']);
  }

  async function runVitePreset(preset: Preset): Promise<void> {
    setActivePreset(preset.id);
    await machine.loadPreset(preset);
    seedViteWorkspace(preset);
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
    await runTerminalSequence(session.id, ['vite']);
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

  const previewUrl = (): string | undefined =>
    devServerRunning() ? `/preview/${machine.realVitePort()}/` : undefined;

  function escapeHtmlAttr(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function openPreviewTab(): void {
    const url = previewUrl();
    if (!url) return;
    const previewWindow = globalThis.window?.open('', '_blank');
    if (!previewWindow) return;
    previewWindow.document.open();
    previewWindow.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>rifty preview ${machine.realVitePort()}</title>
    <style>
      html, body, iframe { margin: 0; width: 100%; height: 100%; border: 0; background: #0f1115; }
    </style>
  </head>
  <body>
    <iframe src="${escapeHtmlAttr(url)}" title="Preview port ${machine.realVitePort()}"></iframe>
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

  const modeLabel = (): string =>
    machine.mode() === 'dev'
      ? 'Dev · port 3000'
      : machine.mode() === 'real-vite'
        ? devServerStatus() === 'running'
          ? `${template.displayName} · port ${machine.realVitePort()}`
          : `${template.displayName} · ${devServerStatus()}`
        : template.displayName;

  const terminalModeHint = (): TerminalModeHint => ({
    label: 'Shell',
    detail: 'Commands run in /workspace; running programs own stdin.',
  });
  const programTitle = (): string => 'src/main.js';
  const hasPreview = (): boolean => devServerStatus() !== 'stopped';
  const isOpfs = props.boot.vfsBoot.backend === 'opfs';

  return (
    <div class="rf-app rf-grain">
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

      <header class="rf-header">
        <span class="rf-brand">
          <span class="rf-brand__mark" aria-hidden="true" />
          <strong class="rf-wordmark">rifty</strong>
        </span>

        <span class="rf-modechip" data-mode={machine.mode()}>
          <span class="rf-modechip__dot" />
          {modeLabel()}
        </span>

        <span class="rf-spacer" />
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
          <ActivityBar
            view={layout.view()}
            collapsed={layout.sidebarCollapsed()}
            onSelect={(v) => layout.selectView(v)}
          />

          <aside class="rf-sidebar">
            <Show when={layout.view() === 'explorer'}>
              {/* real-vite swaps the explorer's backing store. FileExplorer
                  captures `vfs` once, so the mode flip must remount it —
                  Show/fallback does exactly that. */}
              <Show
                when={devServerRunning()}
                fallback={
                  <FileExplorer
                    vfs={vfs}
                    root={WORKSPACE}
                    visible={layout.view() === 'explorer' && !layout.sidebarCollapsed()}
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
                  visible={layout.view() === 'explorer' && !layout.sidebarCollapsed()}
                  activePath={activeFilePath()}
                  onOpenFile={(path) => editorApi?.openFile(path)}
                  onError={flashError}
                />
              </Show>
            </Show>
            <Show when={layout.view() === 'presets'}>
              <PresetGallery activeId={activePreset()} onSelect={onSelectPreset} />
            </Show>
          </aside>

          <Splitter
            orientation="vertical"
            value={layout.sidebarW()}
            min={layout.bounds.sidebarW[0]}
            max={layout.bounds.sidebarW[1]}
            defaultValue={264}
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
                  defaultValue={480}
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
                    refreshKey={previewRevision()}
                    onOpenTab={openPreviewTab}
                  />
                )}
              </Show>
            </div>

            <Splitter
              orientation="horizontal"
              value={layout.consoleH()}
              min={layout.bounds.consoleH[0]}
              max={layout.bounds.consoleH[1]}
              defaultValue={232}
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
              onStopSession={stopSession}
              attach={attachTerminalWriter}
              modeHint={terminalModeHint()}
              historyRecords={terminalHistory}
              onLink={onTerminalLink}
              onSignal={stopSession}
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
          storageReason={props.boot.vfsBoot.reason}
          coi={isCrossOriginIsolated()}
        />
      </Show>

      <Show when={toast()}>
        <output class="rf-toast">{toast()}</output>
      </Show>
    </div>
  );
}
