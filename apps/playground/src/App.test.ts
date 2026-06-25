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
const bootstrapSrc = readFileSync(
  fileURLToPath(new URL('./workers/real-vite-bootstrap.ts', import.meta.url)),
  'utf8',
);

describe('App terminal startup wiring', () => {
  // Revised pins (ADR-0135, prev. node-server template ADR): boot lines are
  // preset-dispatched via presetBootLines() (from-scratch presets prepend the
  // visible `npm install`); the ORIGINAL intent — boot goes through the visible
  // command that owns the worker lifecycle, never cosmetic terminal theater —
  // stays enforced for both runtimes and both setup kinds.
  it('auto-starts the active preset through the command that owns the real worker lifecycle', () => {
    expect(source).toContain(
      'await runTerminalSequence(session.id, presetBootLines(preset, activeRoot()))',
    );
    expect(source).not.toContain("['npm install', 'npm run dev']");
    // hardcoded boot literals bypassing the dispatch helper are banned
    expect(source).not.toContain("['npm run dev']");
    expect(source).not.toContain("['vite']");
  });

  it('holds no page-side authoritative VFS store — the owner is the single store (one authoritative owner; page reads through ports)', () => {
    // Single-store-owner regression guard (exactly one authoritative store; page
    // holds no authoritative fs): the page must not construct or write a local
    // syncMirror; seeding + archive + editor writes all go to the owner.
    expect(source).not.toContain('const vfs = syncMirror()');
    expect(source).not.toContain('writeText(vfs');
    expect(source).not.toContain("from '@riftydev/vfs/internal'");
    expect(source).toContain('seedWorkspaceOwner(preset)');
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

  it('routes editor + program writes to the owner (SSoT, ADR-0148 co-resident dev server in the owner)', () => {
    // The preview worker is gone; editor/program edits flow to the ONE owner so
    // the co-resident dev server HMR-updates against the same store it serves.
    expect(source).toContain('function writeWorkspaceFile(path: string, content: string)');
    // ADR-0165 §3: the owner is a reassignable signal holder (respawned on switch),
    // so member access goes through the `workspaceOwner()` accessor.
    expect(source).toContain('workspaceOwner().writeFile(path, content)');
    // ADR-0165 §4: the program edit lands on the active template entry path.
    expect(source).toContain(
      'const programPath = programMirrorPath(activeRoot(), activeTemplate())',
    );
    expect(source).toContain('scheduleProgramWrite(programPath, next)');
    expect(source).toContain('workspaceOwner().writeFile(pending.path, pending.content)');
    // the legacy hardcoded const is gone from the program write path
    expect(source).not.toContain('writeFile(PROGRAM_MIRROR_PATH');
    // explorer + editor read the owner snapshot, not a vite-gated swap
    expect(source).not.toContain('const activeVfs');
    expect(source).not.toContain('syncPresetFilesToWorker');
    expect(source).not.toContain('.updateEntry(');
  });

  it('seeds picked starter files to the active root before booting dev server without clobbering package.json', () => {
    // A mid-session starter pick must update index.html as well as the entry;
    // otherwise a TypeScript template can write src/main.ts while Vite still
    // serves the old src/main.js HTML. The root package.json is install-owned
    // after boot, so reload seeding must preserve user-added deps.
    expect(source).toContain('const rootPackageJsonPath = `${root}/package.json`;');
    expect(source).toContain('seedFilesForStarter(starterById(preset.id), root)');
    expect(source).toContain('if (path === rootPackageJsonPath) continue;');
    expect(source).toMatch(
      /for \(const \[path, content\] of Object\.entries\(\s*seedFilesForStarter\(starterById\(preset\.id\), root\),\s*\)\) {\s*\/\/ package\.json is install-owned after boot;[\s\S]*?if \(path === rootPackageJsonPath\) continue;\s*workspaceOwner\(\)\.writeFile\(path, content\);/s,
    );
    // the program path follows the active root, threaded into EditorHost too
    expect(source).toContain('root={activeRoot}');
    // skip-double-write guard derives the same root-relative path (no const)
    expect(source).toContain('if (path !== programMirrorPath(activeRoot(), activeTemplate()))');
  });

  it('opens configured preset files as inactive editor tabs', () => {
    expect(source).toContain('function openPresetEditorTabs(preset: Preset): void');
    expect(source).toContain('for (const path of preset.openFiles ?? [])');
    expect(source).toContain('editorApi?.openFile(workspacePresetPath(path), { activate: false })');
    expect(source).toContain('openPresetEditorTabs(preset);');
  });

  it('drives dev-server readiness from the owner pty:dev-server frame, not a stdout log-match', () => {
    // ADR-0148 (co-resident dev server in the owner): the owner reports
    // start/stop + port via a structured frame (owner-tree republish handshake
    // discipline, ADR-0146) — no stdout string-match, no one-shot push.
    expect(source).toContain('workspaceOwner().onDevServer(');
    expect(source).toContain('setDevServerStatus(frame.status)');
    expect(source).not.toContain('node_modules read bridge ready');
  });

  it('starts Vite in an ordinary active terminal instead of a named vite tab', () => {
    expect(source).toContain('function devServerSession()');
    expect(source).toContain('manager.snapshot(manager.activeSessionId())');
    expect(source).not.toContain("title === 'vite'");
    expect(source).not.toContain("manager.createSession('vite')");
    expect(source).not.toContain('function viteSession()');
  });

  it('waits for the existing dev-server terminal to reboot without awaiting the long-running dev line', () => {
    expect(source).toContain('function restartDevServer(sessionId: string)');
    expect(source).toContain('if (restartSessionId) await restartDevServer(restartSessionId)');
    expect(source).not.toContain('if (restartSessionId) void restartDevServer(restartSessionId)');
    expect(source).toContain('await waitForTerminalIdle(devServerSessionId)');
    expect(source).toContain('await waitForDevServerBoot(targetSessionId, generation)');
    expect(source).toContain(
      "if (devServerStatus() !== 'stopped' || terminalStatus(devServerSessionId) === 'running')",
    );
    expect(source).toContain('devServerSessionId = session.id');
    // ADR-0165 §4: boot lines follow the STORE-derived active starter, not the
    // interim activePreset signal — so a switch boots the destination's template.
    expect(source).toContain(
      'void runTerminalSequence(\n      targetSessionId,\n      presetBootLines(presetForId(activeStarterId()), activeRoot()),\n    );',
    );
  });

  it('tags the worker with the project slug and clears the console on a project switch', () => {
    // slug → worker install-stamp reuse key keyed to the ACTIVE ROOT/id (ADR-0165
    // §4: store.activeId — 'scratch' on boot, a projectId after switch); clear →
    // fresh console for the switched-in project.
    expect(source).toContain('slug: store.activeId(),');
    expect(source).toContain("setDevServerStatus('stopped')");
    expect(source).toContain('await manager.rebindOwner(workspaceOwner())');
    expect(source).toContain('manager.clear(targetSessionId)');
    expect(source).toContain('manager.clear(session.id)');
  });

  it('does not restart Vite inside a hidden stale terminal session', () => {
    expect(source).toContain('function isVisibleTerminalSession(id: string): boolean');
    expect(source).toContain(
      'const targetSessionId = isVisibleTerminalSession(sessionId) ? sessionId : devServerSession().id;',
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
    // the page wires the preview SW route on the owner-reported port + token
    expect(source).toContain('wirePreviewBridge(frame.port, workspaceOwner().previewOwnerToken)');
  });

  it('runs npm + dev scripts in the owner (no page-side dev interception)', () => {
    expect(source).not.toContain('runTerminalScript');
    expect(source).not.toContain('npmRunDevBody');
    // dev-server status is owner-reported (frame-driven), not page-flipped
    expect(source).toContain('setDevServerStatus(frame.status)');
    expect(source).toContain('const devServerRunning = (): boolean');
  });

  it('loads and persists terminal environment state', () => {
    expect(source).toContain('env: props.terminalPersistence.initialState.env');
    expect(source).toContain('saveState({ cwd: session.cwd, env: session.env })');
    expect(source).not.toContain('saveState({ cwd: session.cwd, env: {} })');
  });

  it('delegates TS diagnostic synchronization to the versioned helper', () => {
    expect(source).toContain('createTsDiagnosticsSync<Diagnostic, monaco.editor.IMarkerData>');
    expect(source).toContain('api.onDocument(diagnosticSync.handleDocument)');
    expect(source).toContain('diagnosticSync.dispose()');
  });

  it('reinitializes rifty TS when starter files change under the same active root', () => {
    expect(source).toContain('const [tsProjectRevision, setTsProjectRevision] = createSignal(0)');
    expect(source).toContain('tsProjectRevision();');
    expect(source).toContain('setTsProjectRevision((revision) => revision + 1)');
    expect(source).toContain("const wasRunning = devServerStatus() === 'running';");
    expect(source).toContain("if (frame.status === 'running' && !wasRunning)");
  });

  it('routes workspace archive export and import through the owner (one authoritative owner; page reads through ports)', () => {
    // Single-store-owner invariant (one authoritative store; page holds no
    // authoritative fs): the archive reads/writes the OWNER tree (the single
    // store), not a page copy.
    expect(source).toContain('workspaceOwner().exportArchive()');
    expect(source).toContain('workspaceOwner().importArchive(');
    expect(source).toContain("id: 'act:export-workspace'");
    expect(source).toContain("id: 'act:import-workspace'");
    expect(source).toContain('function workspaceArchiveBlocked(): boolean');
    expect(source).toContain("return devServerStatus() !== 'stopped';");
    expect(source).toContain('Stop the dev server to archive the editable workspace');
  });

  it('mounts the preview for a node-only port (dev stopped) + un-gates previewUrl (ADR-0157 C1)', () => {
    // C1: hasPreview ORs the node-server port set, so `node server.js` shows a
    // preview even with the dev server stopped.
    expect(source).toContain(
      "const hasPreview = (): boolean => devServerStatus() !== 'stopped' || previewPorts().length > 0;",
    );
    // C1: previewUrl is membership-gated (any registered preview port), not gated on
    // devServerRunning() — so a node-only "open in new tab" no longer silently no-ops.
    expect(source).toContain('previewPorts().some((p) => p.port === port)');
    expect(source).toContain(
      'const previewUrl = (port = machine.realVitePort()): string | undefined =>',
    );
  });

  it('wires page-side bridges for non-dev preview ports (node servers and vite preview)', () => {
    expect(source).toContain(".filter((p) => p.source !== 'dev-server' && p.port !== devPort)");
    expect(source).not.toContain(".filter((p) => p.source === 'node' && p.port !== devPort)");
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

describe('owner dev-boot clean wiring (ADR-0165 §5)', () => {
  it('owner dev-boot clean is gated on shouldCleanForDevBoot (root OR template change)', () => {
    const src = readFileSync(
      fileURLToPath(new URL('./workers/real-vite-bootstrap.ts', import.meta.url)),
      'utf8',
    );
    expect(src).toContain('shouldCleanForDevBoot');
    expect(src).toContain('lastDevRoot');
    // the legacy template-only guard must be gone
    expect(src).not.toContain('lastDevTemplateId !== devSpec.id');
  });
});

describe('owner serves the project index (ADR-0165 realm split)', () => {
  it('serves the project index over the owner snapshot channel alongside the archive bridge', () => {
    expect(bootstrapSrc).toContain('serveProjectIndex(');
    // keyed on the dedicated owner port + THIS realm's syncMirror (the owner owns
    // the index). Wrapping-agnostic: the 5-arg call (with the reset-refresh hook)
    // formats across lines.
    const indexServe = bootstrapSrc.slice(bootstrapSrc.indexOf('serveProjectIndex('));
    expect(indexServe).toMatch(/serveProjectIndex\(\s*port,/);
    expect(indexServe).toMatch(/syncMirror\(\),/);
    // ADR-0165 §6: the reset-refresh hook (publishSnapshot) is passed so an
    // in-place re-seed republishes the live file snapshot.
    expect(indexServe).toContain('publishSnapshot');
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
    // ADR-0165 §4: the restart path's boot lines follow the store-derived starter.
    expect(source).toContain('presetBootLines(presetForId(activeStarterId()), activeRoot())');
    expect(source).toContain('presetBootLines(preset, activeRoot())');
    expect(source).toContain('root={activeRoot()}'); // FileExplorer prop
    // node_modules prop + preset-path seeding read the dynamic root
    expect(source).toContain('root: activeRoot()');
    expect(source).toContain('normalizePath(`${activeRoot()}/');
    // no lingering WORKSPACE references on any surface
    expect(source).not.toContain('WORKSPACE)');
    expect(source).not.toContain('${WORKSPACE}');
    expect(source).not.toContain('new SnapshotFs(WORKSPACE)');
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
  it('markDirty fires on the owner onFileWritten signal, not a UI counter', () => {
    createRoot((dispose) => {
      let firedWrite: ((path: string, content: string) => void) | undefined;
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
      });
      expect(store.scratch()?.dirty).toBe(false);
      firedWrite?.('/scratch/src/main.js', 'x'); // a REAL owner write
      expect(store.scratch()?.dirty).toBe(true);
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

describe('App wires the sequential switch + index mirror (ADR-0165 §3)', () => {
  it('switches through requestSwitch (the sequential orchestrator), not an inline respawn', () => {
    expect(source).toContain('requestSwitch(');
    // the new owner is created via startWorkspaceOwner inside the orchestrator's spawn
    expect(source).toContain('spawn: ({ root, slug }) =>');
    expect(source).toContain('startWorkspaceOwner({');
  });

  it('awaits the old owner exit before respawn (closed promise threaded into the switch)', () => {
    expect(source).toContain('currentOwner:');
    expect(source).toContain('awaitReady:');
    expect(source).toContain('rewireBridges:');
    expect(source).toContain('restartDevServer:');
  });

  it('hydrates the page project-index mirror from the owner at ready', () => {
    expect(source).toContain('bridgeProjectIndex(');
    expect(source).toContain('.request()'); // subscribe-handshake re-publish
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
