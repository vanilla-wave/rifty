import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { BootResult } from './boot.ts';
// Imported from the glue module (App.tsx re-exports it): App.tsx transitively
// pulls browser-only xterm (`self is not defined`) into the node vitest env, so
// the factory lives in glue/app-project-store.ts to stay unit-testable.
import { createAppProjectStore } from './glue/app-project-store.ts';
import { saveAffordance, storageModeFromBoot } from './glue/degraded-storage.ts';

const source = readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');
const streamsCompatSrc = readFileSync(
  fileURLToPath(new URL('../../../docs/public/compat/streams.md', import.meta.url)),
  'utf8',
);
const httpCompatSrc = readFileSync(
  fileURLToPath(new URL('../../../docs/public/compat/http.md', import.meta.url)),
  'utf8',
);
const streamInteropAdrSrc = readFileSync(
  fileURLToPath(
    new URL(
      '../../../docs/adr/net/0154-http-stream-interop-and-drain-contract.md',
      import.meta.url,
    ),
  ),
  'utf8',
);

describe('App terminal startup wiring', () => {
  // Revised pins (ADR-0135, prev. node-server template ADR): boot lines are
  // preset-dispatched via presetBootLines() (from-scratch presets prepend the
  // visible `npm install`); the ORIGINAL intent — boot goes through the visible
  // command that owns the worker lifecycle, never cosmetic terminal theater —
  // stays enforced for both runtimes and both setup kinds.

  it('cold boot spawns the hidden empty workspace owner (no visible project until a pick)', () => {
    // Launcher gating + the one-shot boot decision are pinned behaviorally in
    // orchestration/project-index-boot.test.ts; here only the App-side spawn glue.
    expect(source).toContain('function createHiddenEmptyWorkspaceOwner(): WorkspaceOwnerHandle');
    expect(source).toContain('template: HIDDEN_EMPTY_TEMPLATE');
    expect(source).toContain('hiddenEmptyBoot: true');
    expect(source).toContain('const initialOwnerHandle = createHiddenEmptyWorkspaceOwner();');
    expect(source).toMatch(/createSignal<WorkspaceOwnerHandle>\(initialOwnerHandle\)/);
    expect(source).not.toContain('startProjectIndexOwner');
    expect(source).toContain('const machine = useMode({});');
    expect(source).not.toContain('void runVitePreset(DEFAULT_PRESET);');
    expect(source).not.toContain('seedViteWorkspace(DEFAULT_PRESET);');
  });

  it('holds no page-side authoritative VFS store — the owner is the single store (one authoritative owner; page reads through ports)', () => {
    // Single-store-owner regression guard (exactly one authoritative store; page
    // holds no authoritative fs): the page must not construct or write a local
    // syncMirror; seeding + archive + editor writes all go to the owner.
    expect(source).not.toContain('const vfs = syncMirror()');
    expect(source).not.toContain('writeText(vfs');
    expect(source).not.toContain("from '@riftydev/vfs/internal'");
    expect(source).toContain('seedWorkspace: (preset) => files.seedOwner(preset),');
  });

  it('follows the active preset template instead of hardcoding the default', () => {
    expect(source).not.toContain('const template = defaultProjectSpec()');
    expect(source).toContain('const activeTemplate = ');
    expect(source).toContain('resolveProjectSpec(');
    expect(source).toContain('.templateId');
    // ADR-0148 (co-resident dev server in the owner): the ONE workspace owner
    // spawns with the ACTIVE template (it hosts both the shell and the
    // co-resident dev server) — no per-run spawn.
    expect(source).toContain('template: activeTemplate()');
    expect(source).not.toContain('startRealVite');
  });

  it('opens preview tabs as an opener-owned iframe wrapper', () => {
    expect(source).toContain('function openPreviewTab(port = machine.realVitePort()): void');
    expect(source).toContain("globalThis.window?.open('', '_blank')");
    expect(source).toContain('previewWindow.document.write');
    expect(source).toContain('<iframe src="${escapeHtmlAttr(url)}"');
    expect(source).toContain('<title>rifty preview ${port}</title>');
  });

  it('threads the starter seed + editor writes through the workspace-files core', () => {
    // Seed semantics (package.json install-owned, ifAbsent reload re-seed) and
    // the owner-routed editor write are pinned behaviorally in
    // orchestration/workspace-files.test.ts; here the App-side bindings.
    expect(source).toContain('seedWorkspace: (preset) => files.seedOwner(preset),');
    expect(source).toContain('onFileWritten={(path, content) => files.writeFile(path, content)}');
    // initial editor tabs follow preset data under the active root, threaded into EditorHost too
    expect(source).toContain('root={activeRoot}');
    expect(source).toContain('initialEditorFiles={publishedInitialEditorFiles}');
    expect(source).toContain(
      "import { initialEditorFilesForPreset } from './glue/initial-editor-files.ts';",
    );
  });

  it('paints a picked starter before boot without repainting or reseeding over early edits', () => {
    // Pick ORDERING (paint → owner → stop-before-write → scratch → seed → boot)
    // is pinned behaviorally in orchestration/preset-boot.test.ts; here the
    // App-side paint glue the ports bind to.
    const loadPresetUi = source.match(
      /async function loadPresetUi\(preset: Preset\): Promise<void> \{[\s\S]*?\n {2}\}/,
    )?.[0];
    expect(loadPresetUi).toBeDefined();
    expect(source).toContain('function resetEditorToActiveInitialFiles(): void');
    expect(source).toContain(
      'const [publishedInitialEditorFiles, setPublishedInitialEditorFiles] = createSignal',
    );
    expect(loadPresetUi).toContain('await machine.loadPreset(preset);');
    expect(loadPresetUi).toContain('paintPickedStarterSnapshot(preset);');
    expect(loadPresetUi).toContain('resetEditorToActiveInitialFiles();');
    expect(source).toContain('function paintPickedStarterSnapshot(preset: Preset): void');
    expect(source).toContain('snapshotFs.update({');
    expect(source).toContain('setPublishedInitialEditorFiles(paths);');
    expect(source).toContain('editorApi?.openInitialFiles(paths)');
    expect(source).not.toContain("createSignal('main.js')");
    expect(source).not.toContain("createSignal('javascript')");
    expect(source).not.toContain('discardPendingProgramWrite');
  });

  it('uses preset openFiles as the complete ordered initial editor tab set', () => {
    expect(source).toContain(
      "import { initialEditorFilesForPreset } from './glue/initial-editor-files.ts';",
    );
    expect(source).toContain(
      'initialEditorFilesForPreset(presetForId(activeStarterId()), activeRoot())',
    );
    expect(source).not.toContain('push(templateForPreset(preset).entry.relativePath)');
    expect(source).not.toContain(
      'editorApi?.openFile(workspacePresetPath(path), { activate: false })',
    );
  });

  it('renders the preset-transition veil from the preset-boot core', () => {
    // Veil truth (true during boot, false + TS-gate resolve in finally; the
    // switch-path begin/end) is pinned behaviorally in orchestration/
    // {preset-boot,workspace-lifecycle}.test.ts; here the JSX surfaces.
    expect(source).toMatch(
      /async function loadPresetUi\(preset: Preset\): Promise<void> \{[\s\S]*?setActivePreset\(preset\.id\);/,
    );
    expect(source).toContain("presetBoot.transitioning() ? 'switching' : devServer.status()");
    expect(source).toMatch(/presetBoot\.transitioning\(\)\s*\?\s*'SWITCHING'/);
    expect(source).toMatch(
      /presetBoot\.transitioning\(\)\s*\?\s*`\$\{activeTemplate\(\)\.displayName\} · switching`/,
    );
  });

  it('palette stop targets only the lifecycle-owned dev session (stale terminals untouched)', () => {
    // The stale-terminal + switch-path session capture semantics are pinned
    // behaviorally in orchestration/{dev-server,workspace}-lifecycle.test.ts.
    expect(source).toContain('const stoppableDevServerSessionId = devServer.stoppableSessionId();');
  });

  it('tags the worker with the project slug and clears the console on a project switch', () => {
    // slug → worker install-stamp reuse key keyed to the ACTIVE ROOT/id (ADR-0165
    // §4: store.activeId — 'scratch' on boot, a projectId after switch); freshConsole
    // → wipe + re-greet the switched-in project's terminal (banner survives the boot clear).
    expect(source).toContain('slug: store.activeId(),');
    expect(source).toContain('markStopped: () => devServer.markStopped(),');
    expect(source).toContain('rebindTerminal: (owner) => manager.rebindOwner(owner),');
    // the fresh console + greeting is a preset-boot port (behavioral); the App
    // binds the real terminal manager + banner:
    expect(source).toContain(
      'freshConsole: (id) => manager.freshConsole(id, terminalWelcomeBanner),',
    );
  });

  // ADR-0148 (co-resident dev server in the owner): the dev server runs IN the
  // owner — EVERY line (npm, vite, `npm run dev`) goes to the owner pty channel;
  // the page no longer intercepts a dev line or hosts a per-run preview worker.
  it('routes every line — including the dev server — to the owner pty channel', () => {
    expect(source).toContain('return manager.runLine(id, line, dims)');
    expect(source).not.toContain('dispatchDevServerLine');
    expect(source).not.toContain('isDevServerLine');
    expect(source).not.toContain('runViteCommand');
    expect(source).not.toContain('DevServerContext');
    // Bridge wiring lives SOLELY on the pty:preview set effect — wiring the
    // derived dev frame too would transiently double-bridge the primary port
    // (C3 clobber; the generic dev-server lifecycle).
    expect(source).not.toContain('wirePreviewBridge(frame.port');
  });

  it('runs npm + dev scripts in the owner (no page-side dev interception)', () => {
    expect(source).not.toContain('runTerminalScript');
    expect(source).not.toContain('npmRunDevBody');
    // dev-server status is owner-reported (frame-driven, pinned behaviorally in
    // the lifecycle core); the page only binds the owner signal to the core:
    expect(source).toContain('devServer.attachOwner(workspaceOwner());');
    expect(source).toContain('onCleanup(() => devServer.dispose());');
  });

  it('loads and persists terminal environment state through the persistence core', () => {
    // Snapshot coalescing (cwd/env + dev command in ONE file, partial updates
    // never wipe the other half) is pinned behaviorally in orchestration/
    // terminal-state-persistence.test.ts; here the App bindings.
    expect(source).toContain('env: props.terminalPersistence.initialState.env,');
    expect(source).toContain('const terminalState = createTerminalStatePersistence({');
    expect(source).toContain('sessionState: (id) => manager.snapshot(id),');
    expect(source).toContain('terminalState.persistTerminalState(id);');
  });

  it('delegates TS diagnostic synchronization to the versioned helper', () => {
    expect(source).toContain('createTsDiagnosticsSync<Diagnostic, monaco.editor.IMarkerData>');
    expect(source).toContain('api.onDocument(diagnosticSync.handleDocument)');
    expect(source).toContain('beforeRequest: waitForTsRequestGate');
    expect(source).toContain('diagnosticSync.dispose()');
  });

  it('waits for the workspace owner before sending TS language-service requests', () => {
    expect(source).toContain('const owner = workspaceOwner();');
    expect(source).toContain('const waitForTsRequestGate = async (): Promise<void> => {');
    expect(source).toContain('await owner.ready;');
    expect(source).toContain('await presetBoot.tsTransitionReady();');
    expect(source).toContain('await waitForTsRequestGate();');
    expect(source).toContain('if (disposed) return false;');
    expect(source).toContain('reinitializeTs: () => reinitializeTsForPickedPreset(),');
  });

  it('reinitializes rifty TS when starter files change under the same active root', () => {
    expect(source).toContain('const [tsProjectRevision, setTsProjectRevision] = createSignal(0)');
    expect(source).toContain('tsProjectRevision();');
    expect(source).toContain('setTsProjectRevision((revision) => revision + 1)');
    // frame gating/edge detection is the lifecycle core's contract (behavioral);
    // the App binds its callbacks to the real signals:
    expect(source).toContain('onOwnerAlive: () => workspace.setOwnerReady(true),');
    expect(source).toContain(
      'onServerRunningEdge: () => setTsProjectRevision((revision) => revision + 1),',
    );
    expect(source).toContain('const replayEvents: EditorDocumentEvent[] = [];');
    expect(source).toContain(
      'await Promise.all(replayEvents.map((ev) => client.open(ev.path, ev.text)));',
    );
    expect(source).toContain('await diagnosticSync.refreshOpenDiagnostics();');
  });

  it('routes workspace archive export and import through the workspace-files core', () => {
    // Owner-tree export/import + the dev-server gate are pinned behaviorally in
    // orchestration/workspace-files.test.ts; here the App-side bindings.
    expect(source).toContain("id: 'act:export-workspace'");
    expect(source).toContain("id: 'act:import-workspace'");
    expect(source).toContain('function workspaceArchiveBlocked(): boolean');
    expect(source).toContain(
      "return presetBoot.transitioning() || devServer.status() !== 'stopped';",
    );
    expect(source).toContain('archiveBlocked: () => workspaceArchiveBlocked(),');
  });

  it('mounts the preview for a node-only port (dev stopped) + un-gates previewUrl (ADR-0157 C1)', () => {
    // C1: hasPreview ORs the node-server port set, so `node server.js` shows a
    // preview even with the dev server stopped.
    expect(source).toContain(
      "devServer.status() !== 'stopped' || devServer.previewPorts().length > 0;",
    );
    // C1: previewUrl is membership-gated (any registered preview port), not gated on
    // devServerRunning() — so a node-only "open in new tab" no longer silently no-ops.
    expect(source).toContain('devServer.previewPorts().some((p) => p.port === port)');
    expect(source).toContain(
      'const previewUrl = (port = machine.realVitePort()): string | undefined =>',
    );
  });

  it('keeps worker snapshots from reloading the preview iframe', () => {
    // ADR-0126 — preview reloads are HMR-client-driven; snapshot reload removed.
    expect(source).not.toContain('previewRevision');
    expect(source).not.toContain('setPreviewRevision');
    expect(source).toContain('<PreviewPanel');
    expect(source).not.toContain('refreshKey=');
    expect(source).toContain('onOpenTab={openPreviewTab}');
  });
});

describe('UI affordance honesty — Export button + Share toast (frictionless-first-poke)', () => {
  it('wires the status-bar Export button to the real archive download', () => {
    expect(source).toContain('onExport={() => void files.downloadArchive()}');
    expect(source).toContain('exportDisabled={workspaceArchiveBlocked()}');
  });

  it('the Share toast no longer implies the user edits travel with the link', () => {
    // share() copies only location.href (no encoded workspace) — the toast must
    // not claim it shares the project. Real share-by-link is the M13 item.
    expect(source).toContain("flashToast('Link copied — opens this playground', 'success')");
    expect(source).not.toContain('Link copied — ${globalThis.location?.host');
  });
});

describe('session data-loss guards — beforeunload + Cmd+W/Cmd+S (frictionless-first-poke)', () => {
  it('Cmd/Ctrl+S kills the save-page dialog, flushes debounced writes + acks', () => {
    expect(source).toContain("(e.key === 's' || e.code === 'KeyS')");
    expect(source).toContain('void editorApi?.flushPendingWrites();');
    expect(source).toContain("flashToast('Saved', 'success');");
  });

  it('Cmd/Ctrl+W closes the active editor tab, not the browser tab', () => {
    expect(source).toContain("(e.key === 'w' || e.code === 'KeyW')");
    expect(source).toContain('if (editorApi?.closeActiveTab()) {');
  });

  it('beforeunload prompts ONLY in memory mode with dirty edits (OPFS never prompts)', () => {
    expect(source).toContain("if (storageMode === 'memory' && store.dirty()) {");
    expect(source).toContain("e.returnValue = '';");
    expect(source).toContain("globalThis.window?.addEventListener('beforeunload', onBeforeUnload)");
  });

  it('a rejected terminal run writes its diagnostic to the terminal, not just the console', () => {
    expect(source).toContain("terminalWriters.get(id)?.(`${message}\\n`, 'stderr')");
  });
});

describe('stream compat docs', () => {
  it('claims Readable.toWeb AND the Writable/Duplex WHATWG bridge', () => {
    expect(streamsCompatSrc).toContain('| `Readable.toWeb` | ✅ |');
    // The Writable/Duplex WHATWG bridge is now CLAIMED (stream-writable-duplex-web-bridge) —
    // Writable.toWeb is no longer a `❌` row.
    expect(streamsCompatSrc).toContain('`Writable.toWeb`');
    expect(streamsCompatSrc).toContain('`Duplex.toWeb`');
    expect(streamsCompatSrc).not.toContain('| `Writable.toWeb` | ❌ |');
    expect(streamsCompatSrc).not.toContain('| `Readable.toWeb` / `Writable.toWeb` | ❌ |');
    expect(streamInteropAdrSrc).toContain('Correction 2026-06-29');
    expect(streamInteropAdrSrc).toContain('Readable.toWeb()');
  });
});

describe('http compat docs', () => {
  it('caveats rawHeaders as fetch-normalized rather than Node-raw', () => {
    expect(httpCompatSrc).toContain('| Request headers / `rawHeaders` | ⚠️ |');
    expect(httpCompatSrc).toContain('derived from Fetch-normalized headers');
    expect(httpCompatSrc).toContain('raw casing/order/duplicates are not claimed');
  });
});

describe('App threads the dynamic root (ADR-0165 §4) — WORKSPACE deleted', () => {
  it('deletes the hardcoded WORKSPACE constant', () => {
    expect(source).not.toContain("const WORKSPACE = '/workspace'");
  });

  it('derives the active root from the active id via rootForId', () => {
    expect(source).toContain('rootForId(');
    // a single derived accessor the surfaces read, not a re-typed literal
    expect(source).toContain('const activeRoot = (): string => rootForId(');
  });

  it('threads activeRoot() through the owner spawn, seed, writes, explorer, and boot lines', () => {
    expect(source).toContain('root: activeRoot()'); // startWorkspaceOwner spawn
    // ADR-0165 §4: the restart path's boot lines follow the store-derived starter —
    // behavioral in the lifecycle core; the App injects the store-derived port:
    expect(source).toContain('activeStarterPreset: () => presetForId(activeStarterId()),');
    expect(source).toContain('presetBootLines(preset, activeRoot())');
    expect(source).toContain('root={activeRoot()}'); // FileExplorer prop
    // node_modules prop + preset-path seeding read the dynamic root
    expect(source).toContain('root: activeRoot()');
    expect(source).toContain(
      'initialEditorFilesForPreset(presetForId(activeStarterId()), activeRoot())',
    );
    expect(source).toContain(
      "import { initialEditorFilesForPreset } from './glue/initial-editor-files.ts';",
    );
    // no lingering WORKSPACE references on any surface
    expect(source).not.toContain('WORKSPACE)');
    expect(source).not.toContain('${WORKSPACE}');
    expect(source).not.toContain('new SnapshotFs(WORKSPACE)');
  });

  it('binds FileExplorer mutations to OwnerRpcFs, keeping SnapshotFs as the read view', () => {
    expect(source).toContain("import { OwnerRpcFs } from './glue/owner-rpc-fs.ts';");
    expect(source).toContain(
      'const ownerRpcFs = new OwnerRpcFs(snapshotFs, () => workspaceOwner())',
    );
    expect(source).toContain('const explorerMutations: FileExplorerMutations = {');
    expect(source).toContain('await flushPendingEditorWrites();');
    expect(source).toContain(
      'editorApi?.closePathTree(from);\n      await ownerRpcFs.renamePath(from, to);',
    );
    expect(source).toContain('await ownerRpcFs.renamePath(from, to);');
    expect(source).toContain('editorApi?.closePathTree(from);');
    expect(source).toContain(
      'editorApi?.closePathTree(path);\n      await ownerRpcFs.deletePath(path);',
    );
    expect(source).toContain('await ownerRpcFs.deletePath(path);');
    expect(source).toContain('editorApi?.closePathTree(path);');
    expect(source).toContain('vfs={snapshotFs}');
    expect(source).toContain('mutations={explorerMutations}');
    expect(source).toContain('onNotify={(message, tone) => flashToast(message, tone)}');
  });

  it('binds the reset-refresh core to the real snapshot/index/dev-server ports', () => {
    // Reset/rename confirms (flush → durable re-seed → mirror flip → active-root
    // frame-gated refresh) are pinned behaviorally in orchestration/
    // reset-refresh.test.ts; here the App bindings.
    expect(source).toContain('const resetRefresh = createResetRefresh({');
    expect(source).toContain('subscribeSnapshot: (cb) => snapshotFs.subscribe(cb),');
    expect(source).toContain(
      'resetScratchIndex: (starter) => resetScratchIndex(workspaceOwner().snapshotPort, starter),',
    );
    expect(source).toContain(
      'awaitActiveSnapshotFrame: () => resetRefresh.waitForActiveSnapshotFrame(),',
    );
    expect(source).toContain('onConfirmRename={() => resetRefresh.confirmRename(renameName())}');
    expect(source).toContain('onConfirmReset={resetRefresh.confirmReset}');
  });

  it('binds the SCM core to the owner feed and threads it into the panels', () => {
    // Feed subscription, path mapping, stale-root guard, diffs and actions are
    // pinned behaviorally in orchestration/scm.test.ts; here the JSX bindings.
    expect(source).toContain('scm.attachOwner(workspaceOwner());');
    expect(source).toContain('onCleanup(() => scm.dispose());');
    expect(source).toContain(
      'subscribeStatus: (owner, cb) => subscribeGitStatus(owner.snapshotPort, cb),',
    );
    expect(source).toContain('gitStatus={scm.gitStatus()}');
    expect(source).toContain('gitStatus={scm.gitStatus}');
    expect(source).toContain('readGitOriginalText={scm.readGitOriginalText}');
  });

  it('wires the GIT panel to the SCM core', () => {
    expect(source).toContain("import { ScmPanel } from './components/ScmPanel.tsx';");
    expect(source).toContain('<ScmPanel');
    expect(source).toContain("layout.view() === 'scm'");
    expect(source).toContain('branch={scm.activeScm().branch}');
    expect(source).toContain('status={scm.gitStatus()}');
    expect(source).toContain('history={scm.activeScm().history}');
    expect(source).toContain('onOpenChange={(row) => void scm.openScmResourceDiff(row)}');
    expect(source).toContain('onStage={scm.stageRow}');
    expect(source).toContain('onUnstage={scm.unstageRow}');
    expect(source).toContain('onDiscard={scm.discardRow}');
    expect(source).toContain('onCommit={scm.commit}');
    expect(source).toContain('gitBranch={scm.activeScm().branch}');
    expect(source).toContain(
      'onCompareFiles={(left, right) => void scm.openWorkingFileCompare(left, right)}',
    );
    expect(source).toContain('onCompareWithHead={(path) => void scm.openWorkingHeadCompare(path)}');
    expect(source).toContain('onDownloadFile={(path) => void files.downloadFile(path)}');
  });

  it('flushes pending editor writes before opening GIT status', () => {
    expect(source).toContain("async function selectSidebarView(view: 'explorer' | 'scm')");
    expect(source).toContain('async function flushPendingEditorWrites(): Promise<void>');
    expect(source).not.toContain('inFlightProgramWrite');
    expect(source).toContain('await editorApi?.flushPendingWrites();');
    expect(source).toContain("if (view === 'scm' && willShow) {");
    expect(source).toContain('await flushPendingEditorWrites();');
    expect(source).toContain('scm.requestActiveGitStatus();');
    expect(source).toContain("onClick={() => void selectSidebarView('scm')}");
  });

  it('does not use an App-level clean hook for ordinary editor file writes', () => {
    expect(source).not.toContain('markPathClean(path)');
    expect(source).not.toContain('editorApi?.markPathClean');
  });
});

// ADAPTED to the committed (signal-accessor) page-store idiom (same adaptation
// page-store.test.ts records): `createPageStore()` + accessor getters
// (`store.scratch()`/`store.dialog()`), toast `{kind,text,undo?}`, and dialog
// `{kind}` carrying `id` (the plan's Task-12 literal `store.state.*`,
// `{type,pendingId}` describes a different dialect Tasks 2/3 did NOT build). The
// behavioral contract — dirty from a REAL owner write, deferred delete that Undo
// cancels — is pinned exactly.
describe('App project wiring', () => {
  it('markDirty fires on the owner onFileWritten signal and persists scratch dirty', () => {
    createRoot((dispose) => {
      let firedWrite: ((path: string, content: string) => void) | undefined;
      const onScratchDirty = vi.fn();
      const owner = {
        onFileWritten: (cb: (p: string, c: string) => void) => {
          firedWrite = cb;
          return () => {};
        },
      };
      const store = createAppProjectStore({
        index: {
          activeId: 'scratch',
          scratch: { starter: 'react', dirty: false, editedAt: 'no edits yet' },
          projects: [],
        },
        storage: 'opfs',
        owner,
        onScratchDirty,
      });
      expect(store.scratch()?.dirty).toBe(false);
      firedWrite?.('/scratch/src/main.js', 'x'); // a REAL owner write
      expect(store.scratch()?.dirty).toBe(true);
      expect(onScratchDirty).toHaveBeenCalledWith('react');
      dispose();
    });
  });

  it('confirmDelete defers the on-disk delete until the toast window; Undo cancels it', () => {
    createRoot((dispose) => {
      const onDiskDelete = vi.fn();
      const store = createAppProjectStore({
        index: {
          activeId: 'p1',
          scratch: null,
          projects: [{ id: 'p1', name: 'node-api', starter: 'node', editedAt: '4m ago' }],
        },
        storage: 'opfs',
        owner: { onFileWritten: () => () => {} },
        onDiskDelete,
      });
      store.openDialog({ kind: 'delete', id: 'p1' });
      store.confirmDelete();
      expect(onDiskDelete).not.toHaveBeenCalled(); // deferred
      store.undoDelete();
      expect(onDiskDelete).not.toHaveBeenCalled(); // Undo cancels — never deletes
      dispose();
    });
  });
});

describe('App binds the slice-2 orchestration cores (ADR-0197)', () => {
  // Switch/restore/index-boot BEHAVIOR is pinned in orchestration/
  // {workspace-lifecycle,project-index-boot}.test.ts; here only the one-line
  // bindings to the real ports and JSX gates.
  it('binds the workspace lifecycle + index-boot cores to the real ports', () => {
    expect(source).toContain('const workspace = createWorkspaceLifecycle<WorkspaceOwnerHandle>({');
    expect(source).toContain(
      'indexBoot.attachOwner(bridgeProjectIndex(workspaceOwner().snapshotPort));',
    );
    expect(source).toContain('onCleanup(() => indexBoot.dispose());');
    expect(source).toContain('<Show when={indexBoot.editorProjectContextReady()}>');
    expect(source).toContain('onDiskDelete: (id) => indexBoot.recordOnDiskDelete(id),');
    expect(source).toContain('onCleanup(indexBoot.startBootPolicy(deepLinkStarterId));');
  });

  it('binds the save-flow core to the real store/lifecycle/index ports', () => {
    // Save/switch decisions (durable-post-first save, plain-Save auto-switch,
    // Save/Discard-then-continue resume, launcher/pick gates) are pinned
    // behaviorally in orchestration/save-flow.test.ts; here the App bindings.
    expect(source).toContain('const saveFlow = createSaveFlow({');
    expect(source).toContain('ownerRoot: () => workspaceOwner().root,');
    expect(source).toContain(
      'saveProjectIndexPhases(workspaceOwner().snapshotPort, id, name, starter),',
    );
    expect(source).toContain('onConfirmSave={() => void saveFlow.confirmSave(saveName())}');
    expect(source).toContain('onSwitchSaveThen={saveFlow.switchSaveThen}');
    expect(source).toContain('onSwitchDiscardThen={saveFlow.switchDiscardThen}');
  });

  it('binds the preset-boot core to the dev-server core and real ports', () => {
    expect(source).toContain('const presetBoot = createPresetBoot<TerminalSessionSnapshot>({');
    expect(source).toContain('runBootSequence: (id, lines) => runTerminalSequence(id, lines),');
    expect(source).toContain('bootLines: (preset) => presetBootLines(preset, activeRoot()),');
  });

  it('does not label a missing active project as the scratch in the header', () => {
    expect(source).not.toContain("if (id === 'scratch') return 'Untitled scratch';");
    expect(source).not.toContain("?.name ?? 'Untitled scratch'");
  });

  it('derives the active scratch display name from the starter label', () => {
    expect(source).toContain('scratchDisplayName(activeGlyph().label)');
    expect(source).toContain('scratchDisplayName(dialogStarterLabel())');
  });
});

// ADAPTED (real-env constraint, recorded): the plan's literal test renders
// `<App boot=.../>` via renderToString. App.tsx transitively imports browser-only
// xterm (`self is not defined` in the node vitest env — same reason the file
// reads App.tsx as SOURCE and tests pure helpers via app-project-store.ts), so it
// cannot be SSR-rendered here. The wiring contract is pinned identically: the
// degraded banner mounts iff memory mode (the DegradedBanner emits
// `data-banner="degraded"`), the StatusBar receives `storageMode`, the storage
// mode + save copy come from the REAL BootResult via the pure derivations, and a
// memory save reports EPHEMERAL never a durable Saved (fidelity).
describe('App degraded path wiring (ADR-0165)', () => {
  const memoryBoot: BootResult = {
    vfsBoot: { backend: 'memory' },
    storage: { available: false },
  } as BootResult;
  const opfsBoot: BootResult = {
    vfsBoot: { backend: 'opfs' },
    storage: { available: true, persistedBefore: true, persistedAfter: true },
  } as BootResult;

  it('derives the page storage mode from the REAL boot backend (memory → memory)', () => {
    expect(storageModeFromBoot(memoryBoot)).toBe('memory');
    expect(storageModeFromBoot(opfsBoot)).toBe('opfs');
  });

  it('wires storage mode + isOpfs through storageModeFromBoot (one source, not an inline ternary)', () => {
    expect(source).toContain('storageModeFromBoot(props.boot)');
    expect(source).toContain('const isOpfs = storageMode === ');
    // the inline backend ternary for isOpfs is gone (single derived source)
    expect(source).not.toContain("const isOpfs = props.boot.vfsBoot.backend === 'opfs'");
  });

  it('mounts the DegradedBanner gated on degradedBannerVisible (memory + undismissed + launcher closed)', () => {
    expect(source).toContain('import { DegradedBanner }');
    expect(source).toContain('degradedBannerVisible({');
    expect(source).toContain('storage: storageMode,');
    expect(source).toContain('launcherOpen: store.launcherOpen(),');
    expect(source).toContain('<DegradedBanner');
    expect(source).toContain('onReEnable={() => globalThis.location?.reload()}');
    expect(source).toContain('onDismiss={() => setBannerDismissed(true)}');
  });

  it('passes storageMode to the StatusBar (memory badge surface hook)', () => {
    expect(source).toContain('storageMode={storageMode}');
  });

  it('a memory-mode save reports EPHEMERAL, never a durable Saved (fidelity), and is wired into the save flow', () => {
    expect(saveAffordance(storageModeFromBoot(memoryBoot)).label).toBe('EPHEMERAL');
    expect(saveAffordance(storageModeFromBoot(memoryBoot)).ephemeral).toBe(true);
    expect(saveAffordance(storageModeFromBoot(memoryBoot)).label).not.toBe('Saved');
    // the App save flow derives its toast from saveAffordance (memory save copy ≠ durable)
    expect(source).toContain('saveAffordance(storageMode)');
    expect(source).toContain('EPHEMERAL (session only)');
  });
});
