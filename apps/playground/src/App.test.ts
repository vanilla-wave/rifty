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
  it('auto-starts the active preset through the command that owns the real worker lifecycle', () => {
    expect(source).toContain(
      'void runTerminalSequence(\n' +
        '        session.id,\n' +
        '        bootLinesOverride ?? presetBootLines(preset, activeRoot()),\n' +
        '      );',
    );
    expect(source).not.toContain("['npm install', 'npm run dev']");
    // hardcoded boot literals bypassing the dispatch helper are banned
    expect(source).not.toContain("['npm run dev']");
    expect(source).not.toContain("['vite']");
  });

  it('gates a clean first-run boot behind the launcher while a hidden empty workspace owns the shell', () => {
    expect(source).toContain('needsProjectChoiceOnBoot');
    expect(source).toContain('function createHiddenEmptyWorkspaceOwner(): WorkspaceOwnerHandle');
    expect(source).toContain('template: HIDDEN_EMPTY_TEMPLATE');
    expect(source).toContain('hiddenEmptyBoot: true');
    expect(source).toContain('const initialOwnerHandle = createHiddenEmptyWorkspaceOwner();');
    expect(source).toMatch(/createSignal<WorkspaceOwnerHandle>\(initialOwnerHandle\)/);
    expect(source).not.toContain('startProjectIndexOwner');
    expect(source).toContain('const machine = useMode({});');
    expect(source).toContain("store.setLauncherTab('starters')");
    expect(source).toContain('store.openLauncher()');
    expect(source).toContain('function closeLauncher(): void');
    expect(source).toContain('initialBootDecisionMade = true;');
    expect(source).toContain('onClose={closeLauncher}');
    expect(source).toContain('await ensureWorkspaceOwnerStarted(false);');
    expect(source).toContain('await durableNewScratch(id, { preserveDirtySameStarter: true });');
    expect(source).toContain('setWorkspaceOwnerReady(true);');
    expect(source).not.toContain('void runVitePreset(DEFAULT_PRESET);');
    expect(source).not.toContain('seedViteWorkspace(DEFAULT_PRESET);');
  });

  it('retries the project-index request until the owner bridge answers', () => {
    expect(source).toContain('let sawIndexReply = false;');
    expect(source).toContain('sawIndexReply = true;');
    expect(source).toContain('const retryRequest = setInterval(() => {');
    expect(source).toContain('if (!sawIndexReply) void mirror.request();');
    expect(source).toContain('clearInterval(retryRequest);');
  });

  it('re-roots the owner to a persisted project on boot AND relaunches its dev server', () => {
    // The cold-boot hidden owner is rooted at /scratch; a project-active index
    // (Save-as-project then reload) must respawn at /projects/<id> — the started
    // short-circuit in ensureWorkspaceOwnerStarted never re-roots, so the boot
    // decision switches on a root mismatch, else adopts the started hidden owner.
    // THEN it relaunches the co-resident dev server (a pty command that died with
    // the previous page): runVitePreset over the persisted tree, else the reopened
    // project shows an empty console + no preview.
    const restore = source.match(
      /async function restoreActiveProjectOnReload\(idx: ProjectIndex\): Promise<void> \{[\s\S]*?\n {2}\}/,
    )?.[0];
    expect(restore).toBeDefined();
    expect(restore).toContain('if (workspaceOwner().root !== rootForId(idx.activeId)) {');
    expect(restore).toContain('if (!(await trackSwitch(switchTo(idx.activeId)))) return;');
    expect(restore).toContain('await ensureWorkspaceOwnerStarted(true);');
    // The relaunch — over the persisted (OPFS-preloaded) tree, never a re-seed —
    // serialized through the preset-transition queue like every other launch. It
    // replays the RECORDED dev command of the previously running session (a fork
    // may have swapped the dev tool), falling back to template boot lines.
    expect(restore).toContain('void queuePresetTransition(() =>');
    expect(restore).toContain(
      'restoreBootLines(props.terminalPersistence.initialState.devCommand, preset, activeRoot())',
    );
    // The boot decision delegates to the restore path (still boot-gated once).
    const bootEffect = source.match(
      /if \(!idx \|\| initialBootDecisionMade\) return;[\s\S]*?\n {2}\}\);/,
    )?.[0];
    expect(bootEffect).toBeDefined();
    expect(bootEffect).toContain('void restoreActiveProjectOnReload(idx);');
  });

  it('flushes pending editor writes before a project switch tears the owner down', () => {
    const switchTo = source.match(
      /async function switchTo\(nextActiveId: ActiveId\): Promise<boolean> \{[\s\S]*?\n {2}\}/,
    )?.[0];
    expect(switchTo).toBeDefined();
    // Flush must precede the not-started flip so the write lands on the still-alive
    // owner rather than being dropped while the tab is marked clean (silent data loss).
    expect(switchTo).toMatch(
      /await flushPendingEditorWrites\(\);[\s\S]*?workspaceOwnerStarted = false;/,
    );
  });

  it('awaits the memory-mode starter seed before the dev server boots', () => {
    // Ephemeral mode has no durable index, so seedViteWorkspace is the only owner-tree
    // seed; it must be awaited before runVitePreset boots vite over an empty scratch.
    expect(source).toContain(
      'if (saveAffordance(storageMode).ephemeral) await seedViteWorkspace(presetForId(id));',
    );
  });

  it('recovers workspaceOwnerStarted from the live owner when a switch fails', () => {
    // A switch that throws before restartDevServer set the flag true must not wedge
    // every later write behind the "choose a project" guard for the session.
    const trackSwitch = source.match(
      /function trackSwitch\(run: Promise<boolean>\): Promise<boolean> \{[\s\S]*?\n {2}\}/,
    )?.[0];
    expect(trackSwitch).toBeDefined();
    expect(trackSwitch).toContain('if (!workspaceOwnerStarted && workspaceOwner().isAlive()) {');
    expect(trackSwitch).toContain('workspaceOwnerStarted = true;');
  });

  it('holds no page-side authoritative VFS store — the owner is the single store (one authoritative owner; page reads through ports)', () => {
    // Single-store-owner regression guard (exactly one authoritative store; page
    // holds no authoritative fs): the page must not construct or write a local
    // syncMirror; seeding + archive + editor writes all go to the owner.
    expect(source).not.toContain('const vfs = syncMirror()');
    expect(source).not.toContain('writeText(vfs');
    expect(source).not.toContain("from '@riftydev/vfs/internal'");
    expect(source).toContain('seedWorkspaceOwner(preset, ifAbsent)');
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

  it('routes editor writes to the owner (SSoT, ADR-0148 co-resident dev server in the owner)', () => {
    // The preview worker is gone; editor edits flow to the ONE owner so
    // the co-resident dev server HMR-updates against the same store it serves.
    expect(source).toContain('const ownerWriteEnc = new TextEncoder();');
    expect(source).toContain('async function writeWorkspaceFile(path: string, content: string)');
    // ADR-0165 §3: the owner is a reassignable signal holder (respawned on switch),
    // so member access goes through the `workspaceOwner()` accessor.
    expect(source).toMatch(
      /await workspaceOwner\(\)\.writeFrameAcked\(\{\s*type: 'write',\s*path,\s*data: ownerWriteEnc\.encode\(content\),\s*\}\);/,
    );
    expect(source).not.toContain('function writeProgramFile');
    expect(source).not.toContain('scheduleProgramWrite');
    expect(source).not.toContain('pendingProgramWrite');
    expect(source).not.toContain('programMirrorPath');
    expect(source).not.toContain('onProgramChange');
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
    expect(source).toContain(
      'async function seedWorkspaceOwner(preset: Preset, ifAbsent = false): Promise<void>',
    );
    expect(source).toMatch(
      /for \(const \[path, content\] of Object\.entries\(\s*seedFilesForStarter\(starterById\(preset\.id\), root\),\s*\)\) {\s*\/\/ package\.json is install-owned after boot;[\s\S]*?if \(path === rootPackageJsonPath\) continue;\s*await workspaceOwner\(\)\.writeFrameAcked\(\{\s*type: 'write',\s*path,\s*data: ownerWriteEnc\.encode\(content\),[\s\S]*?\}\);/s,
    );
    // initial editor tabs follow preset data under the active root, threaded into EditorHost too
    expect(source).toContain('root={activeRoot}');
    expect(source).toContain('initialEditorFiles={publishedInitialEditorFiles}');
    expect(source).toContain(
      "import { initialEditorFilesForPreset } from './glue/initial-editor-files.ts';",
    );
  });

  it('paints a picked starter before boot without repainting or reseeding over early edits', () => {
    const loadPresetUi = source.match(
      /async function loadPresetUi\(preset: Preset\): Promise<void> \{[\s\S]*?\n {2}\}/,
    )?.[0];
    const pickStarterStart = source.indexOf('async function onPickStarter(id: string)');
    const pickStarterEnd = source.indexOf('  // Switch active root', pickStarterStart);
    const pickStarter = source.slice(pickStarterStart, pickStarterEnd);
    const runPreset = source.match(
      /async function runVitePreset\([\s\S]*?\): Promise<void> \{[\s\S]*?\n {2}\}/,
    )?.[0];
    expect(loadPresetUi).toBeDefined();
    expect(pickStarterStart).toBeGreaterThan(-1);
    expect(pickStarterEnd).toBeGreaterThan(pickStarterStart);
    expect(runPreset).toBeDefined();
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
    expect(pickStarter).toMatch(
      /await paintPickedStarterUi\(presetForId\(id\)\);[\s\S]*?setEditorProjectContextReady\(true\);[\s\S]*?await stopDevServerBeforeStarterWrite\(\);[\s\S]*?await durableNewScratch\(id, \{ preserveDirtySameStarter: true \}\);[\s\S]*?setWorkspaceOwnerReady\(true\);[\s\S]*?await runVitePreset\(presetForId\(id\), tsGate\);/,
    );
    expect(runPreset).not.toContain('await loadPresetUi(preset);');
    expect(runPreset).not.toContain('seedViteWorkspace(preset);');
    expect(source).not.toContain("createSignal('main.js')");
    expect(source).not.toContain("createSignal('javascript')");
    expect(source).not.toContain('discardPendingProgramWrite');
  });

  it('does not reseed a picked starter during dev-server boot', () => {
    const runPreset = source.match(
      /async function runVitePreset\([\s\S]*?\): Promise<void> \{[\s\S]*?\n {2}\}/,
    )?.[0];
    expect(runPreset).toBeDefined();
    expect(runPreset).toContain('Re-loading/re-seeding here can erase');
    expect(runPreset).not.toContain('await seedViteWorkspace(preset);');
    expect(runPreset).not.toContain('await flushPendingEditorWrites();');
    expect(runPreset).not.toContain('resetEditorToActiveInitialFiles();');
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

  it('stops an active dev server before writing picked starter files', () => {
    const runPresetStart = source.indexOf('async function runVitePreset(');
    const runPresetEnd = source.indexOf('  // ADR-0165 §3 switch', runPresetStart);
    const runPreset = source.slice(runPresetStart, runPresetEnd);
    const pickStarterStart = source.indexOf('async function onPickStarter(id: string)');
    const pickStarterEnd = source.indexOf('  // Switch active root', pickStarterStart);
    const pickStarter = source.slice(pickStarterStart, pickStarterEnd);
    expect(runPresetStart).toBeGreaterThan(-1);
    expect(runPresetEnd).toBeGreaterThan(runPresetStart);
    expect(pickStarterStart).toBeGreaterThan(-1);
    expect(pickStarterEnd).toBeGreaterThan(pickStarterStart);
    expect(source).toContain('async function stopDevServerSession(sessionId: string | null)');
    expect(source).toContain('async function stopDevServerBeforeStarterWrite(): Promise<void>');
    expect(source).toContain('function lifecycleDevServerRunning(): boolean');
    expect(source).toContain('let devServerBootSessionId: string | null = null;');
    expect(source).toContain('let devServerOwnerSessionId: string | null = null;');
    expect(source).toContain('return lifecycleSessionRunning(devServerSessionId);');
    expect(source).toContain('devServerBootSessionId === sessionId');
    expect(pickStarter.indexOf('await stopDevServerBeforeStarterWrite();')).toBeLessThan(
      pickStarter.indexOf('await durableNewScratch(id, { preserveDirtySameStarter: true });'),
    );
    expect(pickStarter.indexOf('await stopDevServerBeforeStarterWrite();')).toBeLessThan(
      pickStarter.indexOf('await seedViteWorkspace(presetForId(id));'),
    );
    expect(source).not.toContain('async function stopRunningTerminalSessions(): Promise<void>');
    expect(source).not.toContain('function anyTerminalRunning(): boolean');
    expect(runPreset).toContain('const restartNeeded = lifecycleDevServerRunning();');
    expect(runPreset).not.toContain(
      "devServerStatus() !== 'stopped' || terminalStatus(devServerSessionId) === 'running'",
    );
    expect(source).not.toContain("terminalStatus(devServerSessionId) === 'running' ||");
    expect(runPreset).not.toContain('seedViteWorkspace(preset);');
    expect(source).not.toContain('await stopRunningTerminalSessions();');
    expect(source).toContain('setPreviewPorts([])');
  });

  it('shows a preset-switching loader until the picked starter has booted or failed', () => {
    const runPresetStart = source.indexOf('async function runVitePreset(');
    const runPresetEnd = source.indexOf('  // ADR-0165 §3 switch', runPresetStart);
    const runPreset = source.slice(runPresetStart, runPresetEnd);
    const switchToStart = source.indexOf('async function switchTo(nextActiveId: ActiveId)');
    const switchToEnd = source.indexOf('  onMount(() =>', switchToStart);
    const switchTo = source.slice(switchToStart, switchToEnd);
    expect(source).toContain(
      'const [presetTransitioning, setPresetTransitioning] = createSignal(false)',
    );
    expect(runPreset).toContain('setPresetTransitioning(true);');
    expect(source).toMatch(
      /async function loadPresetUi\(preset: Preset\): Promise<void> \{[\s\S]*?setActivePreset\(preset\.id\);/,
    );
    expect(runPreset).toMatch(
      /finally \{[\s\S]*?setPresetTransitioning\(false\);[\s\S]*?tsGate\?\.resolve\(\);[\s\S]*?\}/,
    );
    expect(source).toContain("presetTransitioning() ? 'switching' : devServerStatus()");
    expect(source).toMatch(/presetTransitioning\(\)\s*\?\s*'SWITCHING'/);
    expect(source).toMatch(
      /presetTransitioning\(\)\s*\?\s*`\$\{activeTemplate\(\)\.displayName\} · switching`/,
    );
    expect(switchTo).toMatch(
      /try \{[\s\S]*?setPresetTransitioning\(true\);[\s\S]*?const switched = await requestSwitch/,
    );
    expect(switchTo).toMatch(/if \(switched\) \{[\s\S]*?resetEditorToActiveInitialFiles\(\);/);
    expect(switchTo).toMatch(/finally \{[\s\S]*?setPresetTransitioning\(false\);[\s\S]*?\}/);
  });

  it('drives dev-server readiness from the owner pty:dev-server frame, not a stdout log-match', () => {
    // ADR-0148 (co-resident dev server in the owner): the owner reports
    // start/stop + port via a structured frame (owner-tree republish handshake
    // discipline, ADR-0146) — no stdout string-match, no one-shot push.
    expect(source).toContain('workspaceOwner().onDevServer(');
    expect(source).toContain("if (frame.status === 'stopped') {");
    expect(source).toContain('devServerOwnerSessionId = null;');
    expect(source).toMatch(
      /if \(frame\.sid === undefined \|\| frame\.sid === devServerBootSessionId\) \{[\s\S]*?devServerBootSessionId = null;/,
    );
    expect(source).toContain('devServerOwnerSessionId = frame.sid ?? null;');
    expect(source).toContain('setDevServerStatus(frame.status)');
    expect(source).not.toContain('node_modules read bridge ready');
  });

  it('waits for node-cli presets to finish as terminal commands, not preview servers', () => {
    expect(source).toContain('async function waitForPresetBoot(');
    expect(source).toContain("if (spec.runtime === 'node-cli')");
    expect(source).toContain('await waitForTerminalIdle(sessionId)');
    expect(source).toMatch(
      /await waitForPresetBoot\(\s*session\.id,\s*generation,\s*templateForPreset\(preset\)\s*\)/,
    );
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
    expect(source).toContain('await stopDevServerSession(devServerSessionId)');
    expect(source).toContain('await waitForTerminalIdle(sessionId)');
    expect(source).toContain(
      'await startDevServerSession(sessionId, generation, presetForId(activeStarterId()))',
    );
    expect(source).toMatch(
      /return waitForPresetBoot\(\s*targetSessionId,\s*generation,\s*templateForPreset\(preset\)\s*\)/,
    );
    expect(source).toContain('const restartNeeded = lifecycleDevServerRunning();');
    expect(source).not.toContain('anyTerminalRunning()');
    expect(source).toContain('if (restartNeeded)');
    expect(source).toContain('devServerSessionId = session.id');
    expect(source).not.toContain('acceptRunningStatus');
    // ADR-0165 §4: boot lines follow the STORE-derived active starter, not the
    // interim activePreset signal — so a switch boots the destination's template.
    expect(source).toContain(
      'await startDevServerSession(sessionId, generation, presetForId(activeStarterId()))',
    );
  });

  it('does not treat an already-running foreign dev server as the picked preset boot', () => {
    expect(source).toContain(
      'async function waitForDevServerBoot(sessionId: string, generation: number): Promise<boolean>',
    );
    expect(source).toMatch(
      /devServerStatus\(\) === 'running' && devServerOwnerSessionId === sessionId[\s\S]*?return true;/,
    );
    expect(source).toMatch(
      /if \(terminalStatus\(sessionId\) === 'idle'\) \{[\s\S]*?clearDevServerBootSession\(sessionId\);[\s\S]*?return false;/,
    );
    expect(source).toMatch(/const booted = await waitForPresetBoot\(/);
    expect(source).toContain('if (!booted) return;');
    expect(source).toMatch(
      /return waitForPresetBoot\(\s*targetSessionId,\s*generation,\s*templateForPreset\(preset\)\s*\)/,
    );
    expect(source).toMatch(
      /await waitForPresetBoot\(\s*session\.id,\s*generation,\s*templateForPreset\(preset\)\s*\)/,
    );
  });

  it('does not stop a stale dev-server terminal after its lifecycle frame stopped', () => {
    expect(source).toContain('function lifecycleSessionRunning(sessionId: string | null): boolean');
    expect(source).toMatch(
      /sessionId !== null &&[\s\S]*?devServerBootSessionId === sessionId[\s\S]*?\(terminalStatus\(sessionId\) === 'running' \|\| devServerOwnerSessionId === sessionId\)/,
    );
    expect(source).toMatch(
      /const stopLifecycleRun = lifecycleSessionRunning\(sessionId\);[\s\S]*?if \(sessionId && stopLifecycleRun\) manager\.stop\(sessionId\);/,
    );
    expect(source).toContain('devServerBootSessionId = targetSessionId;');
    expect(source).toContain('devServerBootSessionId = session.id;');
    expect(source).toContain('clearDevServerBootSession(sessionId);');
    expect(source).toContain(
      'const restartDevServerSessionId = lifecycleDevServerRunning() ? devServerSessionId : null;',
    );
    expect(source).toContain(
      'if (restartDevServerSessionId) manager.clear(restartDevServerSessionId);',
    );
    expect(source).toContain(
      'const stoppableDevServerSessionId = devServerOwnerSessionId ?? devServerBootSessionId;',
    );
  });

  it('tags the worker with the project slug and clears the console on a project switch', () => {
    // slug → worker install-stamp reuse key keyed to the ACTIVE ROOT/id (ADR-0165
    // §4: store.activeId — 'scratch' on boot, a projectId after switch); freshConsole
    // → wipe + re-greet the switched-in project's terminal (banner survives the boot clear).
    expect(source).toContain('slug: store.activeId(),');
    expect(source).toContain("setDevServerStatus('stopped')");
    expect(source).toContain('await manager.rebindOwner(workspaceOwner())');
    expect(source).toContain('manager.freshConsole(targetSessionId, terminalWelcomeBanner)');
    expect(source).toContain('manager.freshConsole(session.id, terminalWelcomeBanner)');
  });

  it('marks a same-root launcher open ready without respawning the hidden owner', () => {
    const switchStart = source.indexOf('async function onLauncherSwitch(id: ActiveId)');
    const switchEnd = source.indexOf('// Open the launcher on the REMEMBERED tab', switchStart);
    const switchBody = source.slice(switchStart, switchEnd);
    expect(switchStart).toBeGreaterThan(-1);
    expect(switchEnd).toBeGreaterThan(switchStart);
    expect(switchBody).toContain('if (!prompted && ownerNeedsSwitch)');
    expect(switchBody).toContain('} else if (!prompted) {');
    expect(switchBody).toContain('void ensureWorkspaceOwnerStarted(true);');
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
    // Bridge wiring lives SOLELY on the pty:preview set effect — wiring the
    // derived dev frame too would transiently double-bridge the primary port
    // (C3 clobber; the generic dev-server lifecycle).
    expect(source).not.toContain('wirePreviewBridge(frame.port');
  });

  it('keys non-dev preview bridges by port and preview scope', () => {
    expect(source).toContain('function previewBridgeKey(port: number, previewScope?: string)');
    expect(source).toContain('return JSON.stringify([port, previewScope ?? null])');
    expect(source).toContain('const key = previewBridgeKey(p.port, p.previewScope)');
    expect(source).toMatch(/nodePortBridges\.set\(\s*key,\s*wirePreviewBridge/s);
    expect(source).toContain(
      'wirePreviewBridge(p.port, workspaceOwner().previewOwnerToken, p.previewScope)',
    );
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
    // cwd/env persist per command; the recorded dev command rides along so a
    // later cwd/env save never wipes it (single terminal-state file).
    expect(source).toContain('savedShellState = { cwd: session.cwd, env: session.env };');
    expect(source).toContain('saveState({ ...savedShellState, devCommand: savedDevCommand })');
    expect(source).not.toContain('saveState({ cwd: session.cwd, env: {} })');
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
    expect(source).toContain('await tsPresetTransitionReady;');
    expect(source).toContain('await waitForTsRequestGate();');
    expect(source).toContain('if (disposed) return false;');
  });

  it('reinitializes rifty TS when starter files change under the same active root', () => {
    expect(source).toContain('const [tsProjectRevision, setTsProjectRevision] = createSignal(0)');
    expect(source).toContain('tsProjectRevision();');
    expect(source).toContain('setTsProjectRevision((revision) => revision + 1)');
    expect(source).toContain("if (frame.status !== 'stopped') setWorkspaceOwnerReady(true);");
    expect(source).toContain("const wasRunning = devServerStatus() === 'running';");
    expect(source).toContain("if (frame.status === 'running' && !wasRunning)");
    expect(source).toContain('const replayEvents: EditorDocumentEvent[] = [];');
    expect(source).toContain(
      'await Promise.all(replayEvents.map((ev) => client.open(ev.path, ev.text)));',
    );
    expect(source).toContain('await diagnosticSync.refreshOpenDiagnostics();');
  });

  it('waits for picked starter boot before replaying TS documents', () => {
    const runPresetStart = source.indexOf('async function runVitePreset(');
    const runPresetEnd = source.indexOf('  // ADR-0165 §3 switch', runPresetStart);
    const runPreset = source.slice(runPresetStart, runPresetEnd);
    const pickStarterStart = source.indexOf('async function onPickStarter(id: string)');
    const pickStarterEnd = source.indexOf('  // Switch active root', pickStarterStart);
    const pickStarter = source.slice(pickStarterStart, pickStarterEnd);
    const reinit = source.match(
      /function reinitializeTsForPickedPreset\(\): void \{[\s\S]*?\n {2}\}/,
    )?.[0];
    expect(runPresetStart).toBeGreaterThan(-1);
    expect(runPresetEnd).toBeGreaterThan(runPresetStart);
    expect(source).toContain('let tsPresetTransitionReady: Promise<void> = Promise.resolve();');
    expect(source).toContain('await tsPresetTransitionReady;');
    expect(pickStarterStart).toBeGreaterThan(-1);
    expect(pickStarterEnd).toBeGreaterThan(pickStarterStart);
    expect(pickStarter.indexOf('beginTsPresetTransition();')).toBeLessThan(
      pickStarter.indexOf('store.pickStarter(id);'),
    );
    expect(pickStarter.indexOf('await paintPickedStarterUi(presetForId(id));')).toBeLessThan(
      pickStarter.indexOf('await runVitePreset(presetForId(id), tsGate);'),
    );
    expect(pickStarter).toContain('void queuePresetTransition(runPick);');
    expect(pickStarter).toContain('await runVitePreset(presetForId(id), tsGate);');
    expect(reinit).toBeDefined();
    expect(reinit).toContain('setTsProjectRevision((revision) => revision + 1);');
    expect(reinit).not.toContain('resetEditorToActiveInitialFiles()');
    expect(runPreset).toContain('templateId: templateForPreset(preset).id,');
    expect(runPreset).toContain('await workspaceOwner().setDevConfig({');
    expect(runPreset).not.toContain('await machine.loadPreset(preset);');
    expect(runPreset).toMatch(/finally \{[\s\S]*?tsGate\?\.resolve\(\);[\s\S]*?\}/);
    const sessionReservation = runPreset.indexOf('session = devServerSession();');
    const setDevConfig = runPreset.indexOf('await workspaceOwner().setDevConfig({');
    expect(sessionReservation).toBeGreaterThan(-1);
    expect(setDevConfig).toBeGreaterThan(-1);
    expect(sessionReservation).toBeLessThan(setDevConfig);
    expect(source).toContain(
      "throw new Error('Unable to reserve an idle terminal for the dev server')",
    );
    expect(runPreset).toMatch(
      /session = await ensureReservedDevServerSession\(session\);\s*devServerSessionId = session\.id;\s*manager\.freshConsole\(session\.id, terminalWelcomeBanner\);/,
    );
    expect(runPreset).toMatch(
      /await workspaceOwner\(\)\.setDevConfig\([\s\S]*?await startDevServerSession\(\s*restartSessionId,\s*restartGeneration,\s*preset,\s*bootLinesOverride,\s*\);[\s\S]*?reinitializeTsForPickedPreset\(\);[\s\S]*?return;/,
    );
    expect(runPreset).toMatch(
      /void runTerminalSequence\(\s*session\.id,\s*bootLinesOverride \?\? presetBootLines\(preset, activeRoot\(\)\),\s*\);[\s\S]*?const booted = await waitForPresetBoot\(session\.id, generation, templateForPreset\(preset\)\);[\s\S]*?if \(!booted\) return;[\s\S]*?reinitializeTsForPickedPreset\(\);/,
    );
  });

  it('serializes starter picks while a preset boot is transitioning', () => {
    const pickStarterStart = source.indexOf('async function onPickStarter(id: string)');
    const pickStarterEnd = source.indexOf('  // Switch active root', pickStarterStart);
    const pickStarter = source.slice(pickStarterStart, pickStarterEnd);
    expect(source).toContain('let presetTransitionChain: Promise<void> = Promise.resolve();');
    expect(source).toContain('function queuePresetTransition(');
    expect(pickStarter).toContain('const runPick = async (): Promise<void> => {');
    expect(pickStarter).toMatch(
      /store\.pickStarter\(id\);[\s\S]*?durableNewScratch\(id, \{ preserveDirtySameStarter: true \}\);[\s\S]*?await runVitePreset\(presetForId\(id\), tsGate\);/,
    );
    expect(pickStarter).toMatch(
      /if \(presetTransitioning\(\)\) \{[\s\S]*?await queuePresetTransition\(runPick\);[\s\S]*?return;/,
    );
    expect(pickStarter).toContain('void queuePresetTransition(runPick);');
    expect(pickStarter).not.toContain('void runVitePreset(presetForId(id), tsGate);');
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
    expect(source).toContain("return presetTransitioning() || devServerStatus() !== 'stopped';");
    expect(source).toContain('Stop the dev server to archive the editable workspace');
  });

  it('routes single-file downloads through fresh owner bytes after pending editor writes', () => {
    const downloadStart = source.indexOf('async function downloadWorkspaceFile(path: string)');
    const downloadEnd = source.indexOf('  function decodeTextBlob', downloadStart);
    const downloadBlock = source.slice(downloadStart, downloadEnd);
    expect(downloadStart).toBeGreaterThan(-1);
    expect(downloadEnd).toBeGreaterThan(downloadStart);
    expect(source).toContain('function assertWorkspaceFileOwnerAlive(');
    expect(source).toContain('!owner.isAlive()');
    expect(source).toContain('current !== owner');
    expect(source).toContain('async function readWorkspaceFileBytesFromOwner(');
    expect(source).toContain('async function readWorkspaceFileForDownload(path: string)');
    expect(source).toContain(
      "return readWorkspaceFileBytesFromOwner(workspaceOwner(), path, 'download')",
    );
    expect(source).not.toContain('async function readWorkspaceFileForOwner(');
    expect(source).toContain('const bytes = await owner.readFileBytes(path);');
    expect(source).toMatch(
      /const bytes = await owner\.readFileBytes\(path\);\s+assertWorkspaceFileOwnerAlive\(owner, path, action\);\s+return bytes;/,
    );
    expect(downloadBlock).toContain('await flushPendingEditorWrites();');
    expect(downloadBlock).toContain('const bytes = await readWorkspaceFileForDownload(path);');
    expect(source).toContain('const blobBuffer = new ArrayBuffer(bytes.byteLength);');
    expect(source).toContain('new Uint8Array(blobBuffer).set(bytes);');
    expect(source).toContain('new Blob([blobBuffer], { type:');
    expect(source).toContain('a.download = basename(path);');
    expect(source).toContain('onDownloadFile={(path) => void downloadWorkspaceFile(path)}');
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

  it('wires page-side bridges for EVERY previewable port through the one set path', () => {
    // The pty:preview set (deduped by port in the owner registry) is the single
    // wiring source — no dev-source/devPort exclusions, no second wiring path.
    expect(source).toContain('const entries = previewPorts();');
    expect(source).not.toContain(".filter((p) => p.source !== 'dev-server'");
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
    expect(source).toContain('onExport={() => void downloadWorkspaceArchive()}');
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
  it('claims Readable.toWeb separately from still-unclaimed Writable.toWeb', () => {
    expect(streamsCompatSrc).toContain('| `Readable.toWeb` | ✅ |');
    expect(streamsCompatSrc).toContain('| `Writable.toWeb` | ❌ |');
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
    expect(bootstrapSrc).toContain('serveWorkspaceFileReads(port, cfg.root)');
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
    expect(source).toContain(
      'await startDevServerSession(sessionId, generation, presetForId(activeStarterId()))',
    );
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

  it('waits for owner reset and a fresh snapshot before reopening active initial tabs', () => {
    const resetStart = source.indexOf('function onConfirmReset(): void');
    const resetEnd = source.indexOf('  // Dialog-derived strings', resetStart);
    const resetBlock = source.slice(resetStart, resetEnd);
    expect(resetStart).toBeGreaterThan(-1);
    expect(resetEnd).toBeGreaterThan(resetStart);
    expect(source).toContain('async function waitForActiveSnapshotFrame(): Promise<void>');
    expect(source).toMatch(
      /async function refreshActiveAfterReset\(\): Promise<void> \{[\s\S]*?await waitForActiveSnapshotFrame\(\);[\s\S]*?resetEditorToActiveInitialFiles\(\);/,
    );
    expect(resetBlock).toMatch(
      /await flushPendingEditorWrites\(\);[\s\S]*?await resetScratchIndex\(workspaceOwner\(\)\.snapshotPort, activeStarterId\(\)\);/,
    );
    expect(resetBlock).toContain('await resetProjectIndex(workspaceOwner().snapshotPort, id);');
    expect(resetBlock).toMatch(
      /store\.confirmReset\(\);[\s\S]*?if \(activeReset\) await refreshActiveAfterReset\(\);/,
    );
  });

  it('subscribes to the owner git-status feed and threads it into FileExplorer', () => {
    expect(source).toContain(
      "import { requestGitStatus, subscribeGitStatus } from './glue/git-status-feed.ts';",
    );
    expect(source).toContain('const [gitStatusMap, setGitStatusMap] = createSignal');
    expect(source).toContain('const owner = workspaceOwner();\n    const root = owner.root;');
    expect(source).toContain('subscribeGitStatus(owner.snapshotPort');
    expect(source).toContain('gitStatus={gitStatusMap()}');
  });

  it('wires the GIT panel to the shared status feed and owner git RPC reads', () => {
    expect(source).toContain("import { ScmPanel } from './components/ScmPanel.tsx';");
    expect(source).toContain("import { bridgeGitOwnerRpc } from './glue/git-owner-port.ts';");
    expect(source).toContain('const [gitScmReads, setGitScmReads] = createSignal');
    expect(source).toContain('const activeGitScm = createMemo');
    expect(source).toContain('gitScmReads().root === activeRoot()');
    expect(source).toContain('const git = bridgeGitOwnerRpc(owner.snapshotPort');
    expect(source).toContain('git.currentBranch()');
    expect(source).toContain('git.log({ depth: 20 })');
    expect(source).toContain('<ScmPanel');
    expect(source).toContain("layout.view() === 'scm'");
    expect(source).toContain('branch={activeGitScm().branch}');
    expect(source).toContain('gitBranch={activeGitScm().branch}');
  });

  it('flushes pending editor writes before opening GIT status', () => {
    expect(source).toContain("async function selectSidebarView(view: 'explorer' | 'scm')");
    expect(source).toContain('async function flushPendingEditorWrites(): Promise<void>');
    expect(source).not.toContain('inFlightProgramWrite');
    expect(source).toContain('await editorApi?.flushPendingWrites();');
    expect(source).toContain("if (view === 'scm' && willShow) {");
    expect(source).toContain('await flushPendingEditorWrites();');
    expect(source).toContain('requestActiveGitStatus();');
    expect(source).toContain("onClick={() => void selectSidebarView('scm')}");
  });

  it('respawns the owner at the saved project root after a plain Save-as-project', () => {
    expect(source).toContain('let pendingSaveAutoSwitchId: ActiveId | null = null;');
    expect(source).toContain('function switchToSavedProjectAfterSave(');
    expect(source).toContain('if (saveAffordance(storageMode).ephemeral) return;');
    expect(source).toContain('if (pendingSaveAutoSwitchId !== id) return;');
    expect(source).toContain('if (pendingSwitch) return;');
    expect(source).toContain('if (store.activeId() !== id) return;');
    expect(source).toContain('void trackSwitch(switchTo(id));');
    expect(source).toContain('pendingSaveAutoSwitchId = id;');
    expect(source).toContain('} else if (!ephemeral) {');
    expect(source).toContain('void switchToSavedProjectAfterSave(id, saveWait.durable);');
    expect(source).toContain('pendingSaveAutoSwitchId = null;');
    expect(source).toMatch(
      /const switched = await requestSwitch\([\s\S]*?if \(switched\) \{\s*await waitForActiveSnapshotFrame\(\);\s*resetEditorToActiveInitialFiles\(\);\s*\}/,
    );
  });

  it('opens GIT rows as side-aware blob-vs-blob Monaco diffs from owner HEAD/index/worktree bytes', () => {
    expect(source).toContain('async function openScmResourceDiff(row: ScmResourceRow)');
    expect(source).toContain('await flushPendingEditorWrites();');
    expect(source).toContain('const path = row.path;');
    expect(source).toContain('async function readWorkspaceFileBytesFromOwner(');
    expect(source).toContain('function decodeTextBlob(label: string, bytes: Uint8Array): string');
    expect(source).toContain("new TextDecoder('utf-8', { fatal: true })");
    expect(source).toContain('if (looksBinary(bytes))');
    expect(source).toContain('is not valid UTF-8; text diff is unavailable');
    expect(source).toContain('async function readGitOriginalText(');
    expect(source).toContain('const original = await git.show(`${input.ref}:${relative}`);');
    expect(source).toContain('const index = await git.show(`:${relative}`);');
    // Blob selection is delegated to the tested scm-diff-plan planner, not
    // re-derived inline (covered behaviorally by scm-diff-plan.test.ts).
    expect(source).toContain('const plan = scmDiffPlan(row);');
    expect(source).toContain("plan.original === 'head'");
    expect(source).toContain("plan.modified === 'index'");
    expect(source).toContain('originalTitle: plan.originalTitle,');
    expect(source).toContain('modifiedTitle: plan.modifiedTitle,');
    expect(source).toContain(
      "await readWorkspaceFileBytesFromOwner(owner, path, 'open Git changes')",
    );
    expect(source).not.toContain("readWorkspaceFileForOwner(owner, path, 'open Git changes')");
    expect(source).toContain('currentOwner.snapshotPort !== snapshotPort');
    expect(source).toContain("if (original.type !== 'blob')");
    expect(source).toContain('editorApi?.openTextDiff({');
    expect(source).not.toContain('modified: workingDiffText(row)');
    expect(source).not.toContain('hasOriginal: !rowHasNoHeadBlob(row)');
    expect(source).toContain('readGitOriginalText={readGitOriginalText}');
    expect(source).toContain('gitStatus={gitStatusMap}');
    expect(source).toContain('onOpenChange={(row) => void openScmResourceDiff(row)}');
    expect(source).not.toContain('git.diff(');
  });

  it('wires Explorer compare/upload affordances to owner bytes and generic Monaco text diffs', () => {
    const compareStart = source.indexOf(
      'async function openWorkingFileCompare(leftPath: string, rightPath: string)',
    );
    const compareEnd = source.indexOf('  async function openWorkingHeadCompare', compareStart);
    const compareBlock = source.slice(compareStart, compareEnd);
    const headStart = source.indexOf('async function openWorkingHeadCompare(path: string)');
    const headEnd = source.indexOf('  async function headBlobExistsForCurrentStatus', headStart);
    const headBlock = source.slice(headStart, headEnd);
    expect(compareStart).toBeGreaterThan(-1);
    expect(compareEnd).toBeGreaterThan(compareStart);
    expect(headStart).toBeGreaterThan(-1);
    expect(headEnd).toBeGreaterThan(headStart);
    expect(source).toContain('function assertWorkspaceFileOwnerAlive(');
    expect(source).toContain('async function readWorkspaceFileBytesFromOwner(');
    expect(compareBlock).toContain('await flushPendingEditorWrites();');
    expect(compareBlock).toContain("readWorkspaceFileBytesFromOwner(owner, leftPath, 'compare')");
    expect(compareBlock).toContain("readWorkspaceFileBytesFromOwner(owner, rightPath, 'compare')");
    expect(source).toContain('editorApi?.openTextDiff({');
    expect(source).toContain("id: compareDiffId('working', leftPath, rightPath)");
    expect(headBlock).toContain('await flushPendingEditorWrites();');
    expect(headBlock).toContain("readWorkspaceFileBytesFromOwner(owner, path, 'compare')");
    expect(headBlock).toContain("ref: 'HEAD'");
    expect(headBlock).toContain(
      'hasOriginal: await headBlobExistsForCurrentStatus(owner, path, relative),',
    );
    expect(headBlock).not.toContain('const code = gitStatusMap().get(path);');
    expect(source).toContain(
      "import { scmDiffPlan, statusCodeHasHeadBlob } from './glue/scm-diff-plan.ts'",
    );
    expect(source).toContain('async function headBlobExistsForCurrentStatus(');
    expect(source).toContain('const status = await git.status();');
    expect(source).toContain('porcelainXY(entry.status)');
    expect(source).toContain(
      'onCompareFiles={(left, right) => void openWorkingFileCompare(left, right)}',
    );
    expect(source).toContain('onCompareWithHead={(path) => void openWorkingHeadCompare(path)}');
  });

  it('wires GIT actions through owner git RPC and refreshes owner status after ack', () => {
    expect(source).toContain(
      "import { requestGitStatus, subscribeGitStatus } from './glue/git-status-feed.ts';",
    );
    expect(source).toContain('function assertScmOwner(owner: WorkspaceOwnerHandle): void');
    expect(source).toContain('async function runScmOwnerAction(');
    expect(source).toContain('await flushPendingEditorWrites();');
    expect(source).toContain('requestGitStatus(owner.snapshotPort)');
    expect(source).toContain('if (opts.refreshVfs) requestVfsSnapshot(owner.snapshotPort)');
    expect(source).toContain('async function stageScmRow(row: ScmResourceRow)');
    expect(source).toContain(
      'if (stageDeletesWorkingBlob(row)) await git.remove(row.relativePath);',
    );
    expect(source).toContain('else await git.add(row.relativePath);');
    expect(source).toContain('async function unstageScmRow(row: ScmResourceRow)');
    expect(source).toContain('git.unstage(row.relativePath)');
    expect(source).toContain('async function discardScmRow(row: ScmResourceRow)');
    expect(source).toContain('untracked files are not discardable through git restore');
    expect(source).toContain(
      'globalThis.confirm?.(`Discard changes in ${row.relativePath}? This cannot be undone.`)',
    );
    expect(source).toContain('if (!confirmed) return;');
    expect(source).toContain('await git.restore([row.relativePath]);');
    // Discard must drop the open editor model so the discarded buffer can't be
    // re-flushed to the owner on the next edit, resurrecting the change.
    expect(source).toMatch(
      /await git\.restore\(\[row\.relativePath\]\);[\s\S]*?editorApi\?\.closePath\(row\.path\);/,
    );
    expect(source).toContain('async function commitScm(message: string)');
    expect(source).toContain('await git.commitResolvedIdentity({ message })');
    expect(source).toContain('onStage={stageScmRow}');
    expect(source).toContain('onUnstage={unstageScmRow}');
    expect(source).toContain('onDiscard={discardScmRow}');
    expect(source).toContain('onCommit={commitScm}');
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

  it('hydrates owner index without subscribing to local dirty scratch changes', () => {
    expect(source).toMatch(
      /untrack\(\(\) => \{[\s\S]*?store\.hydrateIndex\(idx\);[\s\S]*?const wasReady = editorProjectContextReady\(\);[\s\S]*?const ready = !needsProjectChoiceOnBoot\(idx\);[\s\S]*?setEditorProjectContextReady\(ready\);[\s\S]*?if \(ready && !wasReady\) resetEditorToActiveInitialFiles\(\);[\s\S]*?\}\);/,
    );
    expect(source).toContain('<Show when={editorProjectContextReady()}>');
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
