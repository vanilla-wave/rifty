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
    // the worker spawns with the ACTIVE template, not the registry default:
    // the dev-server command snapshots it once, then hands it to the spawn
    expect(source).toContain('const template = activeTemplate();');
    expect(source).toContain('await startRealVite({\n        template,');
  });

  it('opens preview tabs as an opener-owned iframe wrapper', () => {
    expect(source).toContain('function openPreviewTab(port = machine.realVitePort()): void');
    expect(source).toContain("globalThis.window?.open('', '_blank')");
    expect(source).toContain('previewWindow.document.write');
    expect(source).toContain('<iframe src="${escapeHtmlAttr(url)}"');
    expect(source).toContain('<title>rifty preview ${port}</title>');
  });

  it('sends preset files before the entry once Vite is ready', () => {
    expect(source).toContain(
      'syncPresetFilesToWorker(handle, presetForId(activePreset()));\n    handle.updateEntry(machine.source());',
    );
  });

  it('opens configured preset files as inactive editor tabs', () => {
    expect(source).toContain('function openPresetEditorTabs(preset: Preset): void');
    expect(source).toContain('for (const path of preset.openFiles ?? [])');
    expect(source).toContain('editorApi?.openFile(workspacePresetPath(path), { activate: false })');
    expect(source).toContain('openPresetEditorTabs(preset);');
  });

  it('waits for the worker preview bridges before treating Vite as ready', () => {
    expect(source).toContain("line.includes('[real-vite/worker] node_modules read bridge ready')");
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

  // ADR-0146 (P2): the PAGE no longer hosts shell commands — npm/shell relocated
  // to the owner pty channel; only the lifecycle-owning dev line stays PAGE-driven
  // (`dispatchDevServerLine`). The ORIGINAL intent — manually starting vite records
  // that terminal as the dev-server owner — is preserved via the dispatch + runViteCommand.
  it('records manually started vite as the dev-server terminal owner', () => {
    expect(source).toContain('async function runViteCommand(ctx: DevServerContext)');
    expect(source).toContain('devServerSessionId = ctx.sessionId;');
    expect(source).toContain('if (isDevServerLine(line)) return dispatchDevServerLine(');
    expect(source).toContain('return await runViteCommand(ctx);');
  });

  it('routes npm run scripts through the same visible dev-server terminal command', () => {
    expect(source).toContain('async function runTerminalScript(');
    expect(source).toContain("if (command.trim() === 'vite') return runViteCommand(ctx);");
    // the node-server script body (e.g. 'node src/main.js') reaches the SAME
    // lifecycle owner, single-sourced from project-spec — no second literal,
    // and the FULL routing line is pinned so a cosmetic rewrite fails here
    expect(source).toContain(
      'if (command.trim() === devScriptCommand(activeTemplate())) return runViteCommand(ctx);',
    );
    expect(source).not.toContain("'node src/main.js'");
    // ADR-0146 (P2): the dev line reaches runTerminalScript via the PAGE dispatch
    // (the old PAGE npm `runScript` callback is gone — npm runs in the owner now).
    expect(source).toContain(
      'return await runTerminalScript(devScriptCommand(activeTemplate()), ctx);',
    );
    // `npm run <script>` is still recognised page-side (single-sourced from
    // project-spec via projectScripts) and its dev-script body routed to the
    // lifecycle owner — pre-P2 `npm run vite` / `npm run dev` parity.
    expect(source).toContain('function npmRunDevBody(line: string, template: ProjectSpec)');
    expect(source).toContain('return projectScripts(template)[name] ?? null;');
    expect(source).toContain('if (npmBody !== null) return await runTerminalScript(npmBody, ctx);');
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
