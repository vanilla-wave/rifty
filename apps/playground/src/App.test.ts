import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');

describe('App terminal startup wiring', () => {
  // Revised pins (ADR-0135, prev. node-server template ADR): boot lines are
  // preset-dispatched via presetBootLines() (from-scratch presets prepend the
  // visible `npm install`); the ORIGINAL intent — boot goes through the visible
  // command that owns the worker lifecycle, never cosmetic terminal theater —
  // stays enforced for both runtimes and both setup kinds.
  it('auto-starts the active preset through the command that owns the real worker lifecycle', () => {
    expect(source).toContain(
      'await runTerminalSequence(session.id, presetBootLines(preset, WORKSPACE))',
    );
    expect(source).not.toContain("['npm install', 'npm run dev']");
    // hardcoded boot literals bypassing the dispatch helper are banned
    expect(source).not.toContain("['npm run dev']");
    expect(source).not.toContain("['vite']");
  });

  it('seeds package.json through the shared project-spec builder', () => {
    // one regex so the builder provably comes from the SHARED project-spec
    // import block, not a local re-definition
    expect(source).toMatch(
      /import \{[^}]*buildProjectPackageJson[^}]*\} from '\.\/templates\/project-spec\.ts'/s,
    );
    expect(source).toContain('const packageJson = buildProjectPackageJson(activeTemplate()).json;');
    expect(source).toContain('writeText(vfs, `${WORKSPACE}/package.json`, packageJson);');
    expect(source).not.toContain('const packageJson = {');
  });

  it('follows the active preset template instead of hardcoding the default', () => {
    expect(source).not.toContain('const template = defaultProjectSpec()');
    expect(source).toContain('const activeTemplate = ');
    expect(source).toContain('resolveProjectSpec(');
    expect(source).toContain('.templateId');
    // ADR-0148 P4: the ONE workspace owner spawns with the ACTIVE template (it
    // hosts both the shell and the co-resident dev server) — no per-run spawn.
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

  it('routes editor + program writes to the owner (SSoT, ADR-0148 P4)', () => {
    // The preview worker is gone; editor/program edits flow to the ONE owner so
    // the co-resident dev server HMR-updates against the same store it serves.
    expect(source).toContain('function syncWorkspaceFileToOwner(path: string)');
    expect(source).toContain('workspaceOwner.writeFile(path,');
    expect(source).toContain('workspaceOwner.writeFile(PROGRAM_MIRROR_PATH, next)');
    expect(source).not.toContain('syncPresetFilesToWorker');
    expect(source).not.toContain('.updateEntry(');
  });

  it('opens configured preset files as inactive editor tabs', () => {
    expect(source).toContain('function openPresetEditorTabs(preset: Preset): void');
    expect(source).toContain('for (const path of preset.openFiles ?? [])');
    expect(source).toContain('editorApi?.openFile(workspacePresetPath(path), { activate: false })');
    expect(source).toContain('openPresetEditorTabs(preset);');
  });

  it('drives dev-server readiness from the owner pty:dev-server frame, not a stdout log-match', () => {
    // ADR-0148 P4: the owner reports start/stop + port via a structured frame
    // (P3 handshake discipline) — no stdout string-match, no one-shot push.
    expect(source).toContain('workspaceOwner.onDevServer(');
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

  it('restarts the existing dev-server terminal when changing presets while Vite is running', () => {
    expect(source).toContain('function restartDevServer(sessionId: string)');
    expect(source).toContain('if (restartSessionId) void restartDevServer(restartSessionId)');
    expect(source).toContain('devServerSessionId = session.id');
    expect(source).toContain(
      'await runTerminalSequence(\n      targetSessionId,\n      presetBootLines(presetForId(activePreset()), WORKSPACE),\n    );',
    );
  });

  it('tags the worker with the project slug and clears the console on a project switch', () => {
    // slug → worker install-stamp reuse key (distinct presets on the same
    // template must not reuse each other's tree, ADR-0135); clear → fresh
    // console for the switched-in project.
    expect(source).toContain('slug: activePreset(),');
    expect(source).toContain('manager.clear(targetSessionId)');
    expect(source).toContain('manager.clear(session.id)');
  });

  it('does not restart Vite inside a hidden stale terminal session', () => {
    expect(source).toContain('function isVisibleTerminalSession(id: string): boolean');
    expect(source).toContain(
      'const targetSessionId = isVisibleTerminalSession(sessionId) ? sessionId : devServerSession().id;',
    );
  });

  // ADR-0148 (P4): the dev server runs IN the owner — EVERY line (npm, vite,
  // `npm run dev`) goes to the owner pty channel; the page no longer intercepts a
  // dev line or hosts a per-run preview worker.
  it('routes every line — including the dev server — to the owner pty channel', () => {
    expect(source).toContain('return manager.runLine(id, line, dims)');
    expect(source).not.toContain('dispatchDevServerLine');
    expect(source).not.toContain('isDevServerLine');
    expect(source).not.toContain('runViteCommand');
    expect(source).not.toContain('DevServerContext');
    // the page wires the preview SW route on the owner-reported port + token
    expect(source).toContain('wirePreviewBridge(frame.port, workspaceOwner.previewOwnerToken)');
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

  it('offers workspace archive export and import commands', () => {
    expect(source).toContain('exportWorkspaceArchive');
    expect(source).toContain('importWorkspaceArchive');
    expect(source).toContain("id: 'act:export-workspace'");
    expect(source).toContain("id: 'act:import-workspace'");
    expect(source).toContain('function workspaceArchiveBlocked(): boolean');
    expect(source).toContain("return devServerStatus() !== 'stopped';");
    expect(source).toContain('Stop the dev server to archive the editable workspace');
  });

  it('shows the preview pane while Vite is starting but opens tabs only once running', () => {
    expect(source).toContain("const hasPreview = (): boolean => devServerStatus() !== 'stopped'");
    expect(source).toContain(
      'const previewUrl = (port = machine.realVitePort()): string | undefined',
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
