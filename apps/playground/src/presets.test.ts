import { describe, expect, it } from 'vitest';
import {
  CATEGORY_ORDER,
  DEFAULT_PRESET,
  PRESETS,
  type Preset,
  presetBootLines,
} from './presets.ts';
import { CLI_REPORT_TEMPLATE } from './templates/cli-report.ts';
import { EXPRESS_SQLITE_TEMPLATE } from './templates/express-sqlite.ts';
import { HONO_API_TEMPLATE } from './templates/hono-api.ts';
import { KOA_API_TEMPLATE } from './templates/koa-api.ts';
import { MARKDOWN_SSG_TEMPLATE } from './templates/markdown-ssg.ts';
import { resolveProjectSpec } from './templates/registry.ts';
import { SOCKET_LAB_TEMPLATE } from './templates/socket-lab.ts';
import { TYPESCRIPT_TEMPLATE } from './templates/typescript.ts';

function presetText(preset: Preset): string {
  return (preset.files ?? []).map((file) => file.content).join('\n');
}

function openablePaths(preset: Preset): Set<string> {
  return new Set((preset.files ?? []).map((file) => file.path));
}

function presetFileContent(preset: Preset, path: string): string {
  const file = preset.files?.find((candidate) => candidate.path === path);
  if (!file) throw new Error(`missing preset file ${preset.id}:${path}`);
  return file.content;
}

describe('playground presets', () => {
  it('offers file-oriented project examples alongside the full real npm project demo', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(3);
    const filePresets = PRESETS.filter((preset) => preset.category === 'Files + modules');

    expect(filePresets).toHaveLength(3);
    expect(filePresets.every((preset) => (preset.files?.length ?? 0) >= 2)).toBe(true);
    expect(filePresets.every((preset) => (preset.openFiles?.length ?? 0) >= 2)).toBe(true);
    for (const preset of filePresets) {
      expect(preset.openFiles?.every((path) => openablePaths(preset).has(path))).toBe(true);
    }
    const projectFiles = PRESETS.find((preset) => preset.id === 'project-files');
    expect(projectFiles && presetFileContent(projectFiles, 'src/main.js')).toContain(
      "import project from './project.json'",
    );
    expect(projectFiles && presetFileContent(projectFiles, 'src/main.js')).toContain(
      "from './project-summary.js'",
    );
    expect(projectFiles && presetFileContent(projectFiles, 'src/main.js')).not.toContain(
      '@vite-ignore',
    );
    const nodeWorker = PRESETS.find((preset) => preset.id === 'node-worker');
    expect(nodeWorker && presetFileContent(nodeWorker, 'src/main.js')).toContain("new URL('src/");
    expect(nodeWorker && presetFileContent(nodeWorker, 'src/main.js')).toContain('await import(');
    expect(nodeWorker && presetFileContent(nodeWorker, 'src/main.js')).toContain('@vite-ignore');
    expect(PRESETS.some((preset) => preset.id === 'real-vite')).toBe(true);
    expect(DEFAULT_PRESET.category).toBe('Files + modules');
    expect(CATEGORY_ORDER).toEqual(['Files + modules', 'Live preview']);
  });

  it('makes the Project files CSS an editable member of the rendered module graph', () => {
    const projectFiles = PRESETS.find((preset) => preset.id === 'project-files');
    expect(projectFiles).toBeDefined();
    if (!projectFiles) throw new Error('unreachable');

    expect(projectFiles.openFiles).toContain('src/workspace.css');
    expect(presetFileContent(projectFiles, 'src/main.js')).toContain("import './workspace.css'");
    expect(presetFileContent(projectFiles, 'src/main.js')).not.toContain('ensureStyle');
  });

  it('imports every seeded workspace.css from the entry instead of an inline style copy', () => {
    const seeded = PRESETS.filter((preset) =>
      (preset.files ?? []).some((file) => file.path === 'src/workspace.css'),
    );
    expect(seeded.map((preset) => preset.id)).toEqual(['project-files', 'node-worker']);
    for (const preset of seeded) {
      expect(presetFileContent(preset, 'src/main.js')).toContain("import './workspace.css'");
      expect(presetText(preset)).not.toContain('ensureStyle');
    }
  });

  it('keeps preset editor tabs as ordinary seeded files without a separate source field', () => {
    for (const preset of PRESETS) {
      const spec = resolveProjectSpec(preset.templateId ?? 'vite');
      const entryPath = spec.entry.relativePath.replace(/^\/+/, '');
      expect('source' in preset).toBe(false);
      expect(openablePaths(preset).has(entryPath)).toBe(true);
      expect(preset.openFiles?.every((path) => openablePaths(preset).has(path))).toBe(true);
    }
  });

  it('ships a TypeScript language-service sandbox preset wired to its .ts template', () => {
    const demo = PRESETS.find((preset) => preset.id === 'typescript-ls');
    expect(demo).toBeDefined();
    if (!demo) throw new Error('unreachable');
    expect(demo.templateId).toBe(TYPESCRIPT_TEMPLATE.id);
    expect(presetFileContent(demo, 'src/main.ts')).toBe(TYPESCRIPT_TEMPLATE.entry.content);
    expect(demo.glyph?.text).toBe('TS');
    expect(demo.openFiles?.[0]).toBe('src/main.ts');

    const filePaths = new Set((demo.files ?? []).map((file) => file.path));
    for (const relPath of Object.keys(TYPESCRIPT_TEMPLATE.extraFiles)) {
      expect(filePaths.has(relPath.replace(/^\/+/, ''))).toBe(true);
    }
    expect(demo.openFiles).toEqual(
      expect.arrayContaining(['tsconfig.json', 'src/model.ts', 'src/math.ts']),
    );
    for (const path of [
      'src/format.ts',
      'node_modules/@rifty/example-types/index.d.ts',
      'node_modules/@rifty/example-types/package.json',
    ]) {
      expect(filePaths.has(path)).toBe(true);
    }
    expect(presetText(demo)).toContain('@rifty/example-types');
    expect(presetText(demo)).toContain('satisfies Widget');
    expect(presetText(demo)).toContain('typecheckTarget');
    expect(presetText(demo)).toContain('formatWidgetName');
    expect(presetText(demo)).toContain('summarizeShape');
  });

  // An HMR-enabled Vite preset must own an accept boundary, otherwise every
  // edit degrades to a full reload. Hand-written `import.meta.hot.accept` is
  // one way; a framework plugin that injects one (React Fast Refresh via
  // `@vitejs/plugin-react`) is the other — which one a preset uses is visible
  // in its seeded `vite.config.*`. The no-full-reload behavior itself is proven
  // in the browser by tests/e2e/react-vite-preset.spec.ts (survive-sentinel).
  it('keeps HMR-enabled browser Vite presets as accept boundaries', () => {
    const browserVitePresets = PRESETS.filter((preset) => {
      const spec = resolveProjectSpec(preset.templateId ?? 'vite');
      return (
        preset.mode === 'real-vite' &&
        spec.runtime === 'vite' &&
        !spec.extraFiles?.['/vite.config.js']?.includes('hmr: false')
      );
    });

    expect(browserVitePresets.map((preset) => preset.id)).toEqual([
      'project-files',
      'node-worker',
      'typescript-ls',
      'real-vite',
    ]);
    for (const preset of browserVitePresets) {
      const spec = resolveProjectSpec(preset.templateId ?? 'vite');
      const fastRefreshPlugin =
        spec.runtime === 'vite' &&
        (spec.extraFiles?.['/vite.config.ts']?.includes('@vitejs/plugin-react') ?? false);
      if (!fastRefreshPlugin) expect(presetText(preset)).toContain('import.meta.hot.accept');
      expect(presetText(preset)).not.toContain('location.reload');
    }
  });

  // Revised pin (node-server template ADR): the honesty invariant — preset
  // prose must not teach a boot line its terminal does not run — now scoped
  // per runtime instead of a global 'npm run dev' ban.
  it('keeps preset prose honest about each runtime boot line', () => {
    const vitePresets = PRESETS.filter(
      (preset) => resolveProjectSpec(preset.templateId ?? 'vite').runtime === 'vite',
    );
    expect(vitePresets.length).toBeGreaterThan(0);
    for (const preset of vitePresets) {
      expect(presetText(preset)).not.toContain('npm run dev');
    }
    expect(vitePresets.map(presetText).join('\n')).toContain('terminal prestarts vite');

    const nodePresets = PRESETS.filter(
      (preset) => preset.templateId && preset.templateId !== 'vite',
    );
    for (const preset of nodePresets) {
      expect(presetText(preset)).not.toContain('terminal prestarts vite');
    }
  });

  it('ships the express+sqlite fullstack demo wired to its node-server template', () => {
    const demo = PRESETS.find((preset) => preset.id === 'express-sqlite');
    expect(demo).toBeDefined();
    if (!demo) throw new Error('unreachable');
    expect(demo.templateId).toBe('express-sqlite');
    expect(demo.mode).toBe('real-vite');
    expect(demo.category).toBe('Live preview');

    expect(presetFileContent(demo, 'src/main.js')).toBe(EXPRESS_SQLITE_TEMPLATE.entry.content);
    expect(demo.openFiles?.[0]).toBe('src/main.js');

    // the page-side explorer shows the same files the worker seeds, in lockstep
    const filePaths = new Set((demo.files ?? []).map((file) => file.path));
    for (const relPath of Object.keys(EXPRESS_SQLITE_TEMPLATE.extraFiles)) {
      expect(filePaths.has(relPath.replace(/^\//, ''))).toBe(true);
    }
    const expressEntry = EXPRESS_SQLITE_TEMPLATE.entry.relativePath.replace(/^\/+/, '');
    for (const file of demo.files ?? []) {
      if (file.path === expressEntry) continue;
      expect(EXPRESS_SQLITE_TEMPLATE.extraFiles[`/${file.path}`]).toBe(file.content);
    }

    expect(demo.openFiles?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(demo.openFiles?.every((path) => openablePaths(demo).has(path))).toBe(true);
  });

  it('ships Vite 8 as an opt-in instant preset distinct from default Vite 7', () => {
    const vite8 = PRESETS.find((preset) => preset.id === 'vite8');
    expect(vite8).toBeDefined();
    if (!vite8) throw new Error('unreachable');
    expect(vite8.mode).toBe('real-vite');
    expect(vite8.setup).toBe('instant');
    expect(vite8.templateId).toBe('vite8');
    expect(vite8.blurb).toMatch(/Vite 8|Rolldown/i);
  });

  it('ships Socket Lab wired to its node-server template and socket matrix rows', () => {
    const demo = PRESETS.find((preset) => preset.id === 'socket-lab');
    expect(demo).toBeDefined();
    if (!demo) throw new Error('unreachable');
    expect(demo.templateId).toBe('socket-lab');
    expect(demo.mode).toBe('real-vite');
    expect(demo.category).toBe('Live preview');
    expect(presetFileContent(demo, 'src/main.js')).toBe(SOCKET_LAB_TEMPLATE.entry.content);
    expect(demo.openFiles?.[0]).toBe('src/main.js');

    const filePaths = new Set((demo.files ?? []).map((file) => file.path));
    for (const relPath of Object.keys(SOCKET_LAB_TEMPLATE.extraFiles)) {
      expect(filePaths.has(relPath.replace(/^\//, ''))).toBe(true);
    }
    const socketEntry = SOCKET_LAB_TEMPLATE.entry.relativePath.replace(/^\/+/, '');
    for (const file of demo.files ?? []) {
      if (file.path === socketEntry) continue;
      expect(SOCKET_LAB_TEMPLATE.extraFiles[`/${file.path}`]).toBe(file.content);
    }
    expect(demo.openFiles?.every((path) => openablePaths(demo).has(path))).toBe(true);

    const text = presetText(demo);
    const scenarioIds = [
      'http-server-loopback',
      'client-request-body-streaming',
      'serverresponse-drain-emission',
      'readable-fromweb-pipe-sink',
      'ws-server-local-upgrade',
      'net-http-framed-server',
      'net/ws-client-external-host',
      'browser-preview-websocket',
      'net-real-tcp-socket-semantics',
      'udp-dgram-surface',
      'tls-https-surface',
      'tls-raw-socket-surface',
      'http2-surface',
      'stream-web-bridge-surface',
      'cross-realm-preview-unbounded-body',
      'cross-realm-http-loopback',
      'wasi-socket-syscalls',
    ];
    for (const id of scenarioIds) expect(text).toContain(id);
    expect(text).toContain('NotImplementedError');
    expect(text).not.toContain('Node sockets supported');
  });

  it('ships the Hono API demo wired to its node-server template', () => {
    const demo = PRESETS.find((preset) => preset.id === 'hono-api');
    expect(demo).toBeDefined();
    if (!demo) throw new Error('unreachable');
    expect(demo.templateId).toBe('hono-api');
    expect(demo.mode).toBe('real-vite');
    expect(demo.setup).toBe('from-scratch');
    expect(demo.category).toBe('Live preview');

    const entryPath = HONO_API_TEMPLATE.entry.relativePath.replace(/^\//, '');
    expect(presetFileContent(demo, entryPath)).toBe(HONO_API_TEMPLATE.entry.content);
    const filePaths = new Set((demo.files ?? []).map((file) => file.path));
    for (const relPath of Object.keys(HONO_API_TEMPLATE.extraFiles)) {
      expect(filePaths.has(relPath.replace(/^\//, ''))).toBe(true);
    }
    for (const file of demo.files ?? []) {
      if (file.path === entryPath) continue;
      expect(HONO_API_TEMPLATE.extraFiles[`/${file.path}`]).toBe(file.content);
    }

    expect(demo.openFiles?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(demo.openFiles?.every((path) => filePaths.has(path))).toBe(true);
  });

  it('ships the CLI report demo wired to its run-to-completion template', () => {
    const demo = PRESETS.find((preset) => preset.id === 'cli-report');
    expect(demo).toBeDefined();
    if (!demo) throw new Error('unreachable');
    expect(demo.templateId).toBe('cli-report');
    expect(demo.mode).toBe('real-vite');
    expect(demo.setup).toBe('from-scratch');
    expect(demo.category).toBe('Live preview');

    const entryPath = CLI_REPORT_TEMPLATE.entry.relativePath.replace(/^\//, '');
    expect(presetFileContent(demo, entryPath)).toBe(CLI_REPORT_TEMPLATE.entry.content);
    const filePaths = new Set((demo.files ?? []).map((file) => file.path));
    for (const relPath of Object.keys(CLI_REPORT_TEMPLATE.extraFiles)) {
      expect(filePaths.has(relPath.replace(/^\//, ''))).toBe(true);
    }
    for (const file of demo.files ?? []) {
      if (file.path === entryPath) continue;
      expect(CLI_REPORT_TEMPLATE.extraFiles[`/${file.path}`]).toBe(file.content);
    }

    expect(demo.openFiles?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(demo.openFiles?.every((path) => filePaths.has(path))).toBe(true);
  });

  it('ships the Koa API demo wired to its node-server template', () => {
    const demo = PRESETS.find((preset) => preset.id === 'koa-api');
    expect(demo).toBeDefined();
    if (!demo) throw new Error('unreachable');
    expect(demo.templateId).toBe('koa-api');
    expect(demo.mode).toBe('real-vite');
    expect(demo.setup).toBe('from-scratch');
    expect(demo.category).toBe('Live preview');

    const entryPath = KOA_API_TEMPLATE.entry.relativePath.replace(/^\//, '');
    expect(presetFileContent(demo, entryPath)).toBe(KOA_API_TEMPLATE.entry.content);
    const filePaths = new Set((demo.files ?? []).map((file) => file.path));
    for (const relPath of Object.keys(KOA_API_TEMPLATE.extraFiles)) {
      expect(filePaths.has(relPath.replace(/^\//, ''))).toBe(true);
    }
    for (const file of demo.files ?? []) {
      if (file.path === entryPath) continue;
      expect(KOA_API_TEMPLATE.extraFiles[`/${file.path}`]).toBe(file.content);
    }

    expect(demo.openFiles?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(demo.openFiles?.every((path) => filePaths.has(path))).toBe(true);
  });

  it('ships the markdown SSG demo wired to its node-server template', () => {
    const demo = PRESETS.find((preset) => preset.id === 'markdown-ssg');
    expect(demo).toBeDefined();
    if (!demo) throw new Error('unreachable');
    expect(demo.templateId).toBe('markdown-ssg');
    expect(demo.mode).toBe('real-vite');
    expect(demo.setup).toBe('from-scratch');
    expect(demo.category).toBe('Live preview');

    const entryPath = MARKDOWN_SSG_TEMPLATE.entry.relativePath.replace(/^\//, '');
    expect(presetFileContent(demo, entryPath)).toBe(MARKDOWN_SSG_TEMPLATE.entry.content);
    const filePaths = new Set((demo.files ?? []).map((file) => file.path));
    for (const relPath of Object.keys(MARKDOWN_SSG_TEMPLATE.extraFiles)) {
      expect(filePaths.has(relPath.replace(/^\//, ''))).toBe(true);
    }
    for (const file of demo.files ?? []) {
      if (file.path === entryPath) continue;
      expect(MARKDOWN_SSG_TEMPLATE.extraFiles[`/${file.path}`]).toBe(file.content);
    }

    expect(demo.openFiles?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(demo.openFiles?.every((path) => filePaths.has(path))).toBe(true);
  });
});

describe('sandbox setup kinds (ADR-0135)', () => {
  it('classifies every preset as instant or from-scratch, with both kinds present', () => {
    for (const preset of PRESETS) {
      expect(['instant', 'from-scratch']).toContain(preset.setup);
    }
    expect(PRESETS.some((preset) => preset.setup === 'instant')).toBe(true);
    expect(PRESETS.some((preset) => preset.setup === 'from-scratch')).toBe(true);
    // the boot default must stay instant: m1/m10 e2e pin the first dev line
    expect(DEFAULT_PRESET.setup).toBe('instant');
  });

  it('boots instant presets straight to the dev line', () => {
    const instant = PRESETS.filter((preset) => preset.setup === 'instant');
    for (const preset of instant) {
      expect(presetBootLines(preset, '/workspace')).toEqual(['vite --port 5174']);
    }
  });

  it('boots from-scratch presets with an EXPLICIT `npm install` before the dev line (Node-faithful)', () => {
    // The dev line never installs as a side effect (faithful: `vite` / `npm run dev`
    // runs the program, it does not fetch deps). A from-scratch preset therefore
    // boots `npm install && <dev>` — the install is a real, visible, honest command;
    // a bare dev line without it fails with a real "Cannot find module".
    const realVite = PRESETS.find((preset) => preset.id === 'real-vite');
    expect(realVite?.setup).toBe('from-scratch');
    expect(presetBootLines(realVite as Preset, '/workspace')).toEqual([
      'cd /workspace && npm install && vite --port 5174',
    ]);

    const fullstack = PRESETS.find((preset) => preset.id === 'express-sqlite');
    expect(fullstack?.setup).toBe('from-scratch');
    expect(presetBootLines(fullstack as Preset, '/workspace')).toEqual([
      'cd /workspace && npm install && npm run dev',
    ]);

    const socketLab = PRESETS.find((preset) => preset.id === 'socket-lab');
    expect(socketLab?.setup).toBe('from-scratch');
    expect(presetBootLines(socketLab as Preset, '/workspace')).toEqual([
      'cd /workspace && npm install && npm run dev',
    ]);

    const hono = PRESETS.find((preset) => preset.id === 'hono-api');
    expect(hono?.setup).toBe('from-scratch');
    expect(presetBootLines(hono as Preset, '/workspace')).toEqual([
      'cd /workspace && npm install && npm run dev',
    ]);

    const cli = PRESETS.find((preset) => preset.id === 'cli-report');
    expect(cli?.setup).toBe('from-scratch');
    expect(presetBootLines(cli as Preset, '/workspace')).toEqual([
      'cd /workspace && npm install && npm run dev',
    ]);

    const ssg = PRESETS.find((preset) => preset.id === 'markdown-ssg');
    expect(ssg?.setup).toBe('from-scratch');
    expect(presetBootLines(ssg as Preset, '/workspace')).toEqual([
      'cd /workspace && npm install && npm run dev',
    ]);

    const koa = PRESETS.find((preset) => preset.id === 'koa-api');
    expect(koa?.setup).toBe('from-scratch');
    expect(presetBootLines(koa as Preset, '/workspace')).toEqual([
      'cd /workspace && npm install && npm run dev',
    ]);
  });

  it('advertises the kind in the preset tag', () => {
    for (const preset of PRESETS) {
      expect(preset.tag?.text).toBe(preset.setup === 'instant' ? 'instant' : 'npm install');
    }
  });
});
