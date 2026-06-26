import { describe, expect, it } from 'vitest';
import {
  CATEGORY_ORDER,
  DEFAULT_PRESET,
  PRESETS,
  type Preset,
  presetBootLines,
} from './presets.ts';
import { EXPRESS_SQLITE_TEMPLATE } from './templates/express-sqlite.ts';
import { resolveProjectSpec } from './templates/registry.ts';
import { SOCKET_LAB_TEMPLATE } from './templates/socket-lab.ts';
import { TYPESCRIPT_TEMPLATE } from './templates/typescript.ts';

function presetText(preset: Preset): string {
  return [preset.source, ...(preset.files ?? []).map((file) => file.content)].join('\n');
}

describe('playground presets', () => {
  it('offers file-oriented project examples alongside the full real npm project demo', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(3);
    const filePresets = PRESETS.filter((preset) => preset.category === 'Files + modules');

    expect(filePresets).toHaveLength(3);
    expect(filePresets.every((preset) => (preset.files?.length ?? 0) >= 2)).toBe(true);
    expect(filePresets.every((preset) => (preset.openFiles?.length ?? 0) >= 2)).toBe(true);
    for (const preset of filePresets) {
      const filePaths = new Set((preset.files ?? []).map((file) => file.path));
      expect(preset.openFiles?.every((path) => filePaths.has(path))).toBe(true);
    }
    const projectFiles = PRESETS.find((preset) => preset.id === 'project-files');
    expect(projectFiles?.source).toContain("import project from './project.json'");
    expect(projectFiles?.source).toContain("from './project-summary.js'");
    expect(projectFiles?.source).not.toContain('@vite-ignore');
    const nodeWorker = PRESETS.find((preset) => preset.id === 'node-worker');
    expect(nodeWorker?.source).toContain("new URL('src/");
    expect(nodeWorker?.source).toContain('await import(');
    expect(nodeWorker?.source).toContain('@vite-ignore');
    expect(PRESETS.some((preset) => preset.id === 'real-vite')).toBe(true);
    expect(DEFAULT_PRESET.category).toBe('Files + modules');
    expect(CATEGORY_ORDER).toEqual(['Files + modules', 'Live preview']);
  });

  it('ships a TypeScript language-service sandbox preset wired to its .ts template', () => {
    const demo = PRESETS.find((preset) => preset.id === 'typescript-ls');
    expect(demo).toBeDefined();
    if (!demo) throw new Error('unreachable');
    expect(demo.templateId).toBe(TYPESCRIPT_TEMPLATE.id);
    expect(demo.source).toBe(TYPESCRIPT_TEMPLATE.entry.content);
    expect(demo.glyph?.text).toBe('TS');

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

  it('keeps browser Vite presets as HMR accept boundaries', () => {
    const browserVitePresets = PRESETS.filter((preset) => {
      const spec = resolveProjectSpec(preset.templateId ?? 'vite');
      return preset.mode === 'real-vite' && spec.runtime === 'vite' && spec.hmr.enabled;
    });

    expect(browserVitePresets.map((preset) => preset.id)).toEqual([
      'project-files',
      'node-worker',
      'typescript-ls',
      'real-vite',
    ]);
    for (const preset of browserVitePresets) {
      expect(preset.source).toContain('import.meta.hot.accept');
      expect(preset.source).not.toContain('location.reload');
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

    // the editor program tab IS the template's server entry (single source)
    expect(demo.source).toBe(EXPRESS_SQLITE_TEMPLATE.entry.content);

    // the page-side explorer shows the same files the worker seeds, in lockstep
    const filePaths = new Set((demo.files ?? []).map((file) => file.path));
    for (const relPath of Object.keys(EXPRESS_SQLITE_TEMPLATE.extraFiles)) {
      expect(filePaths.has(relPath.replace(/^\//, ''))).toBe(true);
    }
    for (const file of demo.files ?? []) {
      expect(EXPRESS_SQLITE_TEMPLATE.extraFiles[`/${file.path}`]).toBe(file.content);
    }

    expect(demo.openFiles?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(demo.openFiles?.every((path) => filePaths.has(path))).toBe(true);
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
    expect(demo.source).toBe(SOCKET_LAB_TEMPLATE.entry.content);

    const filePaths = new Set((demo.files ?? []).map((file) => file.path));
    for (const relPath of Object.keys(SOCKET_LAB_TEMPLATE.extraFiles)) {
      expect(filePaths.has(relPath.replace(/^\//, ''))).toBe(true);
    }
    for (const file of demo.files ?? []) {
      expect(SOCKET_LAB_TEMPLATE.extraFiles[`/${file.path}`]).toBe(file.content);
    }
    expect(demo.openFiles?.every((path) => filePaths.has(path))).toBe(true);

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
      expect(presetBootLines(preset, '/workspace')).toEqual([
        'vite --host 0.0.0.0 --strictPort --port 5174',
      ]);
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
      'cd /workspace && npm install && vite --host 0.0.0.0 --strictPort --port 5174',
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
  });

  it('advertises the kind in the preset tag', () => {
    for (const preset of PRESETS) {
      expect(preset.tag?.text).toBe(preset.setup === 'instant' ? 'instant' : 'npm install');
    }
  });
});
