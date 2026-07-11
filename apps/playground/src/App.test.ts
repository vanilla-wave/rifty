import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { saveAffordance, storageModeFromBoot } from '@riftydev/workbench';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { BootResult } from './boot.ts';
// Imported from the glue module (App.tsx re-exports it): App.tsx transitively
// pulls browser-only xterm (`self is not defined`) into the node vitest env, so
// the factory lives in glue/app-project-store.ts to stay unit-testable.
import { createAppProjectStore } from './glue/app-project-store.ts';

// RESIDUAL source-grep pins (epic playground-testable-core). App.tsx cannot
// render in the node vitest env (transitively imports browser-only xterm), so
// its wiring is pinned as SOURCE — minimally. Behavior lives in the extracted
// cores (orchestration/*.test.ts: dev-server/workspace lifecycles, preset +
// project-index boot, save-flow, reset-refresh, workspace-files, scm, terminal
// persistence), glue/*.test.ts, and tests/e2e. Every surviving expect(source)
// is either
//   (a) a NEGATIVE pin on an architectural invariant (single authoritative
//       owner, no page-side dev-server interception, no WORKSPACE constant, no
//       program-write model, no snapshot-driven preview reload), or
//   (b) THE binding pin for one App wiring surface — the core instantiation or
//       the JSX/port line whose silent rewiring neither tsc nor a behavioral
//       test would catch (swapped accessor, dropped onCleanup, stale handler).
// Do not re-grow: tools/checks/source-grep-ratchet.mjs ratchets the count.
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
  it('cold boot spawns the hidden empty workspace owner and never auto-boots a preset', () => {
    // Launcher gating + the one-shot boot decision are behavioral in
    // orchestration/project-index-boot.test.ts; here the spawn binding only.
    expect(source).toContain('const initialOwnerHandle = createHiddenEmptyWorkspaceOwner();');
    expect(source).toContain('template: HIDDEN_EMPTY_TEMPLATE');
    // (a) project-first cold boot: chooser, no auto-boot of the default preset.
    expect(source).not.toContain('void runVitePreset(DEFAULT_PRESET);');
  });

  it('does not warm the lazy editor stack at app eval before user/project intent', () => {
    // First-run chooser idle must not fetch/eval Monaco. Warm only through the
    // boot/pick intent ports (behavioral pins in project-index/preset-boot tests).
    const appEvalBlock = source.slice(0, source.indexOf('/** BroadcastChannel key'));
    expect(appEvalBlock).not.toContain("void import('./components/EditorHost.tsx')");
    expect(appEvalBlock).not.toContain("void import('./glue/ts-ls-monaco-providers.ts')");
    expect(source).toContain('function warmEditorStack(): void');
  });

  it('holds no page-side authoritative VFS store — the owner is the single store', () => {
    // (a) one authoritative owner; the page must not construct a local mirror.
    // `@riftydev/vfs/internal` is a declared export, so check:arch ALLOWS it —
    // this pin is the only guard.
    expect(source).not.toContain('const vfs = syncMirror()');
    expect(source).not.toContain("from '@riftydev/vfs/internal'");
  });

  it('spawns the ONE owner with the ACTIVE template — no page-side dev server', () => {
    // ADR-0148: the owner hosts shell + co-resident dev server; swapping the
    // spawn back to a hardcoded template is tsc-silent.
    expect(source).toContain('template: activeTemplate()');
    expect(source).not.toContain('startRealVite');
  });

  it('opens preview tabs as an opener-owned iframe wrapper', () => {
    // No behavioral heir (popup windows unreachable in node + e2e); the
    // wrapper mechanics are the contract: opener-owned window, escaped src.
    expect(source).toContain("globalThis.window?.open('', '_blank')");
    expect(source).toContain('<iframe src="${escapeHtmlAttr(url)}"');
  });

  it('threads the starter seed + editor writes through the workspace-files core', () => {
    // Seed semantics + owner-routed writes are behavioral in
    // orchestration/workspace-files.test.ts; here the App-side bindings.
    expect(source).toContain('seedWorkspace: (preset) => files.seedOwner(starterById(preset.id)),');
    expect(source).toContain('onFileWritten={(path, content) => files.writeFile(path, content)}');
    // initial tabs follow the STORE-derived starter under the ACTIVE root
    expect(source).toContain(
      'initialEditorFilesForPreset(presetForId(activeStarterId()), activeRoot())',
    );
  });

  it('paints a picked starter before boot (ordering glue; behavior in the preset-boot core)', () => {
    const loadPresetUi = source.match(
      /async function loadPresetUi\(preset: Preset\): Promise<void> \{[\s\S]*?\n {2}\}/,
    )?.[0];
    expect(loadPresetUi).toBeDefined();
    expect(loadPresetUi).toContain('setActivePreset(preset.id);');
    expect(loadPresetUi).toContain('paintPickedStarterSnapshot(preset);');
    expect(loadPresetUi).toContain('resetEditorToActiveInitialFiles();');
    // (a) program-write model stays deleted
    expect(source).not.toContain('discardPendingProgramWrite');
  });

  it('renders the preset-transition veil from the preset-boot core', () => {
    // Veil truth is behavioral in orchestration/{preset-boot,workspace-lifecycle}
    // .test.ts; the pill binding (which accessor feeds the UI) is tsc-silent.
    expect(source).toContain("presetBoot.transitioning() ? 'switching' : devServer.status()");
  });

  it('palette stop targets only the lifecycle-owned dev session (stale terminals untouched)', () => {
    expect(source).toContain('const stoppableDevServerSessionId = devServer.stoppableSessionId();');
  });

  it('tags the worker with the store-derived slug and re-greets the switched-in console', () => {
    // slug = install-stamp reuse key keyed to store.activeId() (ADR-0165 §4);
    // freshConsole binds the REAL terminal manager + welcome banner.
    expect(source).toContain('slug: store.activeId(),');
    expect(source).toContain(
      'freshConsole: (id) => manager.freshConsole(id, terminalWelcomeBanner),',
    );
  });

  it('routes every line through the public terminal controller over the owner pty', () => {
    expect(source).toContain('return terminal.run(id, line, dims)');
    // (a) ADR-0148: no page-side dev-server interception layer.
    expect(source).not.toContain('dispatchDevServerLine');
    // (a) bridge wiring lives SOLELY on the pty:preview effect (C3 clobber).
    expect(source).not.toContain('wirePreviewBridge(frame.port');
  });

  it('attaches the dev-server lifecycle core to the owner signal and disposes it', () => {
    // Frame semantics are behavioral in orchestration/dev-server-lifecycle
    // .test.ts; the attach effect + onCleanup are tsc-silent if dropped.
    expect(source).toContain('devServer.attachOwner(workspaceOwner());');
    expect(source).toMatch(/unsubscribeDevServerState\(\);[\s\S]*devServerCore\.dispose\(\);/);
  });

  it('persists terminal environment state through the persistence core', () => {
    // Snapshot coalescing is behavioral in orchestration/terminal-state-
    // persistence.test.ts; here the core instantiation + the live-session port.
    expect(source).toContain('const terminalState = createTerminalStatePersistence({');
    expect(source).toContain('sessionState: (id) => manager.snapshot(id),');
  });

  it('delegates TS diagnostic synchronization to the versioned helper', () => {
    expect(source).toContain('createTsDiagnosticsSync<Diagnostic, monaco.editor.IMarkerData>');
    expect(source).toContain('api.onDocument(diagnosticSync.handleDocument)');
    expect(source).toContain('beforeRequest: waitForTsRequestGate');
  });

  it('gates TS requests on the owner AND the preset transition', () => {
    // The gate composition is App glue with no behavioral heir.
    expect(source).toContain('await owner.ready;');
    expect(source).toContain('await presetBoot.tsTransitionReady();');
    expect(source).toContain('reinitializeTs: () => reinitializeTsForPickedPreset(),');
  });

  it('reinitializes rifty TS when starter files change under the same active root', () => {
    // tsProjectRevision() is the effect's tracking read — dropping it kills the
    // resubscribe without any tsc or behavioral signal.
    expect(source).toContain('tsProjectRevision();');
    expect(source).toContain(
      'onServerRunningEdge: () => setTsProjectRevision((revision) => revision + 1),',
    );
    // reinit replays the open documents into the fresh LS
    expect(source).toContain(
      'await Promise.all(replayEvents.map((ev) => client.open(ev.path, ev.text)));',
    );
  });

  it('gates workspace archive on transition/dev-server and binds the port', () => {
    // Export/import flows are behavioral in orchestration/workspace-files
    // .test.ts; the gate DEFINITION + its port binding live here.
    expect(source).toContain(
      "return presetBoot.transitioning() || devServer.status() !== 'stopped';",
    );
    expect(source).toContain('archiveBlocked: () => workspaceArchiveBlocked(),');
  });

  it('mounts the preview for a node-only port (dev stopped) + un-gates previewUrl (ADR-0157 C1)', () => {
    // Referenced by tests/e2e/node-command.spec.ts as the unit pin for the
    // un-gating (the e2e asserts the live route).
    expect(source).toContain(
      "devServer.status() !== 'stopped' || devServer.previewPorts().length > 0;",
    );
    expect(source).toContain('devServer.previewPorts().some((p) => p.port === port)');
  });

  it('keeps worker snapshots from reloading the preview iframe (ADR-0126)', () => {
    // (a) preview reloads are HMR-client-driven; the snapshot refreshKey stays deleted.
    expect(source).not.toContain('refreshKey=');
    expect(source).toContain('onOpenTab={openPreviewTab}');
  });
});

describe('UI affordance honesty — Export button + Share toast (frictionless-first-poke)', () => {
  it('wires the status-bar Export button to the real archive download', () => {
    expect(source).toContain('onExport={() => void files.downloadArchive()}');
  });

  it('the Share toast does not imply the user edits travel with the link', () => {
    // share() copies only location.href — the copy must not claim more.
    expect(source).toContain("flashToast('Link copied — opens this playground', 'success')");
  });
});

describe('session data-loss guards — beforeunload + Cmd+W/Cmd+S (frictionless-first-poke)', () => {
  // No behavioral or e2e heir: keyboard + unload glue is client-only.
  it('Cmd/Ctrl+S kills the save-page dialog and flushes debounced writes', () => {
    expect(source).toContain('void editorApi?.flushPendingWrites();');
  });

  it('Cmd/Ctrl+W closes the active editor tab, not the browser tab', () => {
    expect(source).toContain('if (editorApi?.closeActiveTab()) {');
  });

  it('beforeunload prompts ONLY in memory mode with dirty edits (OPFS never prompts)', () => {
    expect(source).toContain("if (storageMode === 'memory' && store.dirty()) {");
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
  it('never re-declares a WORKSPACE constant (usages without it are tsc errors)', () => {
    expect(source).not.toContain('const WORKSPACE = ');
  });

  it('derives the active root from the active id via one accessor', () => {
    expect(source).toContain('const activeRoot = (): string => rootForId(');
  });

  it('threads activeRoot() + the store-derived starter through spawn and explorer', () => {
    expect(source).toContain('root: activeRoot()'); // startWorkspaceOwner spawn
    // restart-path boot lines follow the STORE-derived starter (lifecycle port)
    expect(source).toContain('activeStarter: () => starterById(activeStarterId()),');
    expect(source).toContain('root={activeRoot()}'); // FileExplorer prop
  });

  it('binds FileExplorer mutations to OwnerRpcFs (owner-routed, SnapshotFs read view)', () => {
    // Mutation ordering (close tabs → owner RPC) is e2e-covered
    // (scm-file-manager rename/delete specs); coordinator disposal is behavioral
    // in workbench fault tests. This is only the host binding pin.
    expect(source).toMatch(
      /const ownerRpcFs = new OwnerRpcFs\(snapshotFs, \(\) => workspaceOwner\(\)\)[\s\S]*ownerRpcFs\.dispose\(\);/,
    );
  });

  it('binds the reset-refresh core to the real snapshot + dialog ports', () => {
    // Reset/rename semantics are behavioral in orchestration/reset-refresh
    // .test.ts; reset confirm is e2e-covered (project-management).
    expect(source).toContain('const resetRefresh = createResetRefresh({');
    expect(source).toContain('subscribeSnapshot: (cb) => snapshotFs.subscribe(cb),');
    expect(source).toContain('onConfirmRename={() => resetRefresh.confirmRename(renameName())}');
  });

  it('binds the SCM core to the owner feed and disposes it', () => {
    // Feed/diff/action semantics are behavioral in orchestration/scm.test.ts;
    // panel actions (stage/commit/diff/download) are e2e-covered
    // (scm-file-manager). Attach/dispose/subscribe are the tsc-silent bindings.
    expect(source).toContain('scm.attachOwner(workspaceOwner());');
    expect(source).toContain('onCleanup(() => scm.dispose());');
    expect(source).toContain(
      'subscribeStatus: (owner, cb) => subscribeGitStatus(owner.snapshotPort, cb),',
    );
  });

  it('feeds the GIT panel from the core and keeps explorer compares wired', () => {
    expect(source).toContain('status={scm.gitStatus()}');
    // explorer compares have NO e2e/behavioral heir — both bindings pinned
    expect(source).toContain(
      'onCompareFiles={(left, right) => void scm.openWorkingFileCompare(left, right)}',
    );
    expect(source).toContain('onCompareWithHead={(path) => void scm.openWorkingHeadCompare(path)}');
  });

  it('requests fresh GIT status when the panel opens (flush is e2e-covered)', () => {
    expect(source).toContain('scm.requestActiveGitStatus();');
    // (a) program-write model stays deleted
    expect(source).not.toContain('inFlightProgramWrite');
  });

  it('does not use an App-level clean hook for ordinary editor file writes', () => {
    expect(source).not.toContain('markPathClean');
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

describe('App binds the orchestration cores (ADR-0197)', () => {
  // Behavior is in orchestration/*.test.ts; here only the core instantiations
  // + the port/JSX bindings whose loss is tsc-silent.
  it('binds the workspace lifecycle + index-boot cores to the real ports', () => {
    expect(source).toContain('const workspace = createWorkspaceLifecycle<WorkspaceOwnerHandle>({');
    expect(source).toContain(
      'indexBoot.attachOwner(bridgeProjectIndex(workspaceOwner().snapshotPort));',
    );
    expect(source).toContain('<Show when={indexBoot.editorProjectContextReady()}>');
    expect(source).toContain('onDiskDelete: (id) => indexBoot.recordOnDiskDelete(id),');
    expect(source).toContain('onCleanup(indexBoot.startBootPolicy(deepLinkStarterId));');
  });

  it('binds the save-flow core to the real store/index ports', () => {
    // Save/switch decisions are behavioral in orchestration/save-flow.test.ts;
    // the switch-then dialog paths are e2e-covered (project-management).
    expect(source).toContain('const saveFlow = createSaveFlow({');
    expect(source).toContain(
      'saveProjectIndexPhases(workspaceOwner().snapshotPort, id, name, starter),',
    );
    expect(source).toContain('onConfirmSave={() => void saveFlow.confirmSave(saveName())}');
  });

  it('binds the preset-boot core to the dev-server core and real ports', () => {
    expect(source).toContain('const presetBoot = createPresetBoot<TerminalSessionSnapshot>({');
    expect(source).toContain('runBootSequence: (id, lines) => runTerminalSequence(id, lines),');
    expect(source).toContain('bootLines: (preset) => presetBootLines(preset, activeRoot()),');
  });

  it('does not label a missing active project as the scratch in the header', () => {
    expect(source).not.toContain("'Untitled scratch'");
  });

  it('derives the active scratch display name from the starter label', () => {
    expect(source).toContain('scratchDisplayName(activeGlyph().label)');
  });
});

// ADAPTED (real-env constraint, recorded): the plan's literal test renders
// `<App boot=.../>` via renderToString. App.tsx transitively imports browser-only
// xterm (`self is not defined` in the node vitest env — same reason the file
// reads App.tsx as SOURCE and tests pure helpers via app-project-store.ts), so it
// cannot be SSR-rendered here. The wiring contract is pinned identically: the
// degraded banner mounts iff memory mode, the StatusBar receives `storageMode`,
// the storage mode + save copy come from the REAL BootResult via the pure
// derivations, and a memory save reports EPHEMERAL never a durable Saved.
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

  it('wires the storage mode through storageModeFromBoot (one source, not an inline ternary)', () => {
    expect(source).toContain('storageModeFromBoot(props.boot)');
  });

  it('mounts the DegradedBanner gated on degradedBannerVisible with the real ports', () => {
    // Gate logic is behavioral in glue/degraded-storage.test.ts; the App binds
    // the real storage mode + launcher signal.
    expect(source).toContain('degradedBannerVisible({');
    expect(source).toContain('launcherOpen: store.launcherOpen(),');
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
  });
});
