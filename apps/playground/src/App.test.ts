import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');

describe('App terminal startup wiring', () => {
  it('auto-starts Vite through the command that owns the real worker lifecycle', () => {
    expect(source).toContain("await runTerminalSequence(session.id, ['vite'])");
    expect(source).not.toContain("['npm install', 'npm run dev']");
    expect(source).not.toContain("['npm run dev']");
  });

  it('seeds package.json through the shared project-spec builder', () => {
    expect(source).toContain(
      "import { buildProjectPackageJson } from './templates/project-spec.ts'",
    );
    expect(source).toContain('const packageJson = buildProjectPackageJson(template).json;');
    expect(source).toContain('writeText(vfs, `${WORKSPACE}/package.json`, packageJson);');
    expect(source).not.toContain('const packageJson = {');
    expect(source).toContain("await runTerminalSequence(session.id, ['vite'])");
    expect(source).not.toContain("await runTerminalSequence(session.id, ['npm run dev'])");
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
    expect(source).toContain("await runTerminalSequence(targetSessionId, ['vite'])");
  });

  it('does not restart Vite inside a hidden stale terminal session', () => {
    expect(source).toContain('function isVisibleTerminalSession(id: string): boolean');
    expect(source).toContain(
      'const targetSessionId = isVisibleTerminalSession(sessionId) ? sessionId : devServerSession().id;',
    );
  });

  it('records manually started vite as the dev-server terminal owner', () => {
    expect(source).toContain('async function runViteCommand(ctx: TerminalCommandContext)');
    expect(source).toContain('devServerSessionId = ctx.sessionId;');
    expect(source).toContain('const viteCommand: TerminalCommand');
    expect(source).toContain('commands: { npm: npmCommand, vite: viteCommand }');
  });

  it('routes npm run scripts through the same visible Vite terminal command', () => {
    expect(source).toContain('async function runTerminalScript(');
    expect(source).toContain("if (command.trim() === 'vite') return runViteCommand(ctx);");
    expect(source).toContain('runScript: async (scriptName, command) =>');
  });

  it('loads and persists terminal environment state', () => {
    expect(source).toContain('env: props.terminalPersistence.initialState.env');
    expect(source).toContain('saveState({ cwd: session.cwd, env: session.env })');
    expect(source).not.toContain('saveState({ cwd: session.cwd, env: {} })');
  });

  it('shows the preview pane while Vite is starting but opens tabs only once running', () => {
    expect(source).toContain("const hasPreview = (): boolean => devServerStatus() !== 'stopped'");
    expect(source).toContain(
      'const previewUrl = (port = machine.realVitePort()): string | undefined',
    );
  });

  it('refreshes the preview after the worker confirms VFS writes through snapshots', () => {
    expect(source).toContain('const [previewRevision, setPreviewRevision] = createSignal(0)');
    expect(source).toContain('setPreviewRevision((n) => n + 1);');
    expect(source).not.toContain('if (devServerRunning()) setPreviewRevision');
    expect(source).toContain('<PreviewPanel');
    expect(source).toContain('refreshKey={previewRevision()}');
    expect(source).toContain('onOpenTab={openPreviewTab}');
  });
});
