import { NotImplementedError } from '@riftydev/vfs';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectSpec } from './project-spec.ts';
import { DEFAULT_TEMPLATE_ID, defaultProjectSpec, resolveProjectSpec } from './registry.ts';

type WebpackDevServerTemplateContract = Extract<
  ProjectSpec,
  { readonly runtime: 'npm-dev-server' }
>;

function resolveWebpackDevServerTemplate(): WebpackDevServerTemplateContract {
  const spec = resolveProjectSpec('webpack-dev-server');
  if (spec.runtime !== 'npm-dev-server') {
    throw new Error('webpack-dev-server registry entry has the wrong runtime');
  }
  return spec;
}

describe('resolveProjectSpec', () => {
  it('returns the vite spec for the default id and DEFAULT_TEMPLATE_ID resolves to it', () => {
    const spec = resolveProjectSpec('vite');
    expect(spec.id).toBe('vite');
    expect(spec.displayName.length).toBeGreaterThan(0);
    // pins the generic-naming requirement — a revert to "Real Vite" branding fails
    expect(spec.displayName).not.toBe('Real Vite');
    expect(spec.install).toHaveProperty('vite');

    expect(resolveProjectSpec(DEFAULT_TEMPLATE_ID)).toBe(spec);
    expect(defaultProjectSpec()).toBe(spec);
  });

  it('registers the opt-in vite8 preset distinctly from the default vite template', () => {
    const vite = resolveProjectSpec('vite');
    const vite8 = resolveProjectSpec('vite8');
    expect(vite8.id).toBe('vite8');
    expect(vite8.runtime).toBe('vite');
    expect(vite8.install).toEqual({ vite: '8.0.16' });
    expect(vite.install).not.toEqual(vite8.install);
    expect(vite.bakedNodeModulesUrl).not.toBe(vite8.bakedNodeModulesUrl);
  });

  it('registers the react-vite starter as an install-only Vite 7 template', () => {
    const spec = resolveProjectSpec('react-vite');
    expect(spec.id).toBe('react-vite');
    expect(spec.runtime).toBe('vite');
    if (spec.runtime !== 'vite') throw new Error('unreachable');
    expect(spec.entry.relativePath).toBe('/src/main.tsx');
    expect(spec.install).toHaveProperty('react');
    expect(spec.devDependencies).toHaveProperty('@vitejs/plugin-react');
    // from-scratch tile: no baked snapshot, so `instant` can never select it
    expect(spec.bakedNodeModulesUrl).toBeUndefined();
    // its own visible config lives in the .ts slot — the vanilla template's
    // `/vite.config.js` seed must not leak in
    expect(Object.keys(spec.extraFiles ?? {})).toContain('/vite.config.ts');
    expect(Object.keys(spec.extraFiles ?? {})).not.toContain('/vite.config.js');
    expect(resolveProjectSpec('vite').extraFiles).not.toBe(spec.extraFiles);
  });

  it('registers an ordinary webpack 5 dev-server project with an npm-owned dev script', () => {
    const spec = resolveWebpackDevServerTemplate();

    expect(spec.id).toBe('webpack-dev-server');
    expect(spec.displayName).toBe('Webpack dev server');
    expect(spec.runtime).toBe('npm-dev-server');
    expect(spec.install).toEqual({});
    expect(spec.devDependencies).toEqual({
      webpack: '^5.0.0',
      'webpack-cli': '^5.0.0',
      'webpack-dev-server': '^5.0.0',
      'css-loader': '^7.0.0',
      'style-loader': '^4.0.0',
    });
    expect(spec.entry.relativePath).toBe('/src/index.js');
    expect(spec.defaultPort).toBe(5184);
    expect(spec.packageType).toBe(false);
    expect(spec.devCommand).toBe('webpack serve');
  });

  it('carries the exact webpack source bundle without Rifty-only compatibility switches', () => {
    const spec = resolveWebpackDevServerTemplate();

    expect(Object.keys(spec.extraFiles).sort()).toEqual([
      '/README.md',
      '/public/index.html',
      '/src/styles.css',
      '/webpack.config.js',
    ]);
    expect(spec.entry.content).toMatch(/import\s+['"]\.\/styles\.css['"]/);
    expect(spec.entry.content).toContain('import.meta.webpackHot');

    const config = spec.extraFiles['/webpack.config.js'] ?? '';
    expect(config).toMatch(/require\(['"]node:path['"]\)/);
    expect(config).toContain('module.exports');
    expect(config).toMatch(/Number\(process\.env\.PORT\s*\?\?\s*5184\)/);
    expect(config).toMatch(/publicPath:\s*['"]auto['"]/);
    expect(config).toMatch(/hot:\s*true/);
    expect(config).toMatch(/use:\s*\[['"]style-loader['"],\s*['"]css-loader['"]\]/);
    expect(config).toMatch(/allowedHosts:\s*\[['"]localhost['"]\]/);
    expect(config).not.toMatch(/allowedHosts:\s*['"]all['"]/);
    expect(config).not.toMatch(/allowedHosts:\s*true/);
    expect(config).not.toMatch(/allowedHosts:[^\n]*(?:\*|netlify\.app)/);
    expect(config).not.toContain('0.0.0.0');
    expect(config).not.toContain('client.webSocketURL');
    expect(config).not.toContain('hashFunction');

    expect(spec.extraFiles['/public/index.html']).toContain('id="app"');
    expect(spec.extraFiles['/src/styles.css']?.trim().length).toBeGreaterThan(0);
    const readme = spec.extraFiles['/README.md'] ?? '';
    expect(readme).toMatch(/ordinary webpack project/i);
    expect(readme).toContain('npm run dev');
    expect(readme).toContain('webpack serve');
    expect(readme).toMatch(/stock HMR/i);
  });

  it('[fault: provenance-lie] renders only the exact browser deployment hostname', async () => {
    vi.stubGlobal('location', { hostname: 'preview.rifty.test' });
    vi.resetModules();
    try {
      const { WEBPACK_DEV_SERVER_TEMPLATE } = await import('./webpack-dev-server.ts');
      const config = WEBPACK_DEV_SERVER_TEMPLATE.extraFiles['/webpack.config.js'] ?? '';

      expect(config).toMatch(/allowedHosts:\s*\[['"]preview\.rifty\.test['"]\]/);
      expect(config).not.toMatch(/allowedHosts:\s*['"]all['"]/);
      expect(config).not.toMatch(/allowedHosts:[^\n]*(?:\*|netlify\.app)/);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('uses the explicit localhost fixture outside a browser', async () => {
    vi.stubGlobal('location', undefined);
    vi.resetModules();
    try {
      const { WEBPACK_DEV_SERVER_TEMPLATE } = await import('./webpack-dev-server.ts');
      const config = WEBPACK_DEV_SERVER_TEMPLATE.extraFiles['/webpack.config.js'] ?? '';

      expect(config).toMatch(/allowedHosts:\s*\[['"]localhost['"]\]/);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('[fault: corrupt-input] rejects a browser location without a hostname', async () => {
    vi.stubGlobal('location', { hostname: '' });
    vi.resetModules();
    try {
      await expect(import('./webpack-dev-server.ts')).rejects.toThrow(/hostname/i);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('throws NotImplementedError for an unknown template id (no silent fallback)', () => {
    expect(() => resolveProjectSpec('svelte')).toThrow(NotImplementedError);
    expect(() => resolveProjectSpec('svelte')).toThrow(/templates\.resolveProjectSpec/);
    expect(() => resolveProjectSpec('svelte')).toThrow(/svelte/);
  });

  it('resolves the express-sqlite node-server template', () => {
    const spec = resolveProjectSpec('express-sqlite');
    expect(spec.runtime).toBe('node-server');
    if (spec.runtime !== 'node-server') throw new Error('unreachable');
    expect(spec.install).toHaveProperty('express');
    expect(spec.entry.relativePath).toBe('/src/main.js');
    // server entry talks to the builtin DB and a real npm express
    expect(spec.entry.content).toContain("from 'node:sqlite'");
    expect(spec.entry.content).toContain("from 'express'");
    // client assets the server serves via express.static
    expect(Object.keys(spec.extraFiles)).toEqual(
      expect.arrayContaining(['/public/index.html', '/public/client.js']),
    );
    // demo must not collide with the vite template's port
    expect(spec.defaultPort).not.toBe(resolveProjectSpec('vite').defaultPort);
  });

  it('resolves the TypeScript sandbox template with a real .ts entry', () => {
    const spec = resolveProjectSpec('typescript');
    expect(spec.runtime).toBe('vite');
    if (spec.runtime !== 'vite') throw new Error('unreachable');
    expect(spec.entry.relativePath).toBe('/src/main.ts');
    expect(spec.entry.content).toContain('satisfies');
    expect(spec.install).toHaveProperty('vite');
    expect(spec.displayName).toMatch(/TypeScript/);
  });

  it('resolves the socket-lab node-server template', () => {
    const spec = resolveProjectSpec('socket-lab');
    expect(spec.runtime).toBe('node-server');
    if (spec.runtime !== 'node-server') throw new Error('unreachable');
    expect(spec.install).toEqual({ ws: '^8.18.3' });
    expect(spec.entry.relativePath).toBe('/src/main.js');
    expect(spec.entry.content).toContain("from 'node:http'");
    expect(spec.entry.content).toContain("from 'node:module'");
    expect(spec.entry.content).toContain("require('ws')");
    expect(spec.entry.content).toContain('net.connect');
    expect(Object.keys(spec.extraFiles)).toEqual(
      expect.arrayContaining(['/public/index.html', '/public/client.js', '/public/styles.css']),
    );
    expect(spec.defaultPort).not.toBe(resolveProjectSpec('vite').defaultPort);
    expect(spec.defaultPort).not.toBe(resolveProjectSpec('express-sqlite').defaultPort);
  });

  it('resolves the hono middleware node-server template', () => {
    const spec = resolveProjectSpec('hono-api');
    expect(spec.runtime).toBe('node-server');
    if (spec.runtime !== 'node-server') throw new Error('unreachable');
    expect(spec.install).toHaveProperty('hono');
    expect(spec.install).toHaveProperty('@hono/node-server');
    expect(spec.entry.relativePath).toBe('/src/main.js');
    expect(spec.entry.content).toContain("from 'hono'");
    expect(spec.entry.content).toContain("from '@hono/node-server'");
    expect(spec.entry.content).toContain('serve({');
    expect(Object.keys(spec.extraFiles)).toEqual(
      expect.arrayContaining(['/public/index.html', '/public/client.js']),
    );
    expect(spec.defaultPort).not.toBe(resolveProjectSpec('vite').defaultPort);
    expect(spec.defaultPort).not.toBe(resolveProjectSpec('express-sqlite').defaultPort);
  });

  it('resolves the koa middleware node-server template', () => {
    const spec = resolveProjectSpec('koa-api');
    expect(spec.runtime).toBe('node-server');
    if (spec.runtime !== 'node-server') throw new Error('unreachable');
    expect(spec.install).toHaveProperty('koa');
    expect(spec.install).toHaveProperty('@koa/router');
    expect(spec.entry.relativePath).toBe('/src/main.js');
    expect(spec.entry.content).toContain("from 'koa'");
    expect(spec.entry.content).toContain("from '@koa/router'");
    expect(spec.entry.content).toContain('app.callback()');
    expect(spec.entry.content).toContain('ctx.cookies');
    expect(Object.keys(spec.extraFiles)).toEqual(
      expect.arrayContaining(['/public/index.html', '/public/client.js']),
    );
    expect(spec.defaultPort).not.toBe(resolveProjectSpec('vite').defaultPort);
    expect(spec.defaultPort).not.toBe(resolveProjectSpec('express-sqlite').defaultPort);
    expect(spec.defaultPort).not.toBe(resolveProjectSpec('hono-api').defaultPort);
  });

  it('resolves the run-to-completion CLI template', () => {
    const spec = resolveProjectSpec('cli-report');
    expect(spec.runtime).toBe('node-cli');
    if (spec.runtime !== 'node-cli') throw new Error('unreachable');
    expect(spec.install).toHaveProperty('yaml');
    expect(spec.entry.relativePath).toBe('/src/cli.js');
    expect(spec.entry.content).toContain("from 'yaml'");
    expect(spec.entry.content).toContain("from 'node:fs'");
    expect(Object.keys(spec.extraFiles)).toEqual(
      expect.arrayContaining(['/data/packages.yml', '/README.md']),
    );
  });

  it('resolves the markdown SSG node-server template', () => {
    const spec = resolveProjectSpec('markdown-ssg');
    expect(spec.runtime).toBe('node-server');
    if (spec.runtime !== 'node-server') throw new Error('unreachable');
    expect(spec.install).toHaveProperty('marked');
    expect(spec.entry.relativePath).toBe('/src/main.js');
    expect(spec.entry.content).toContain("from 'marked'");
    expect(spec.entry.content).toContain("from 'node:http'");
    expect(Object.keys(spec.extraFiles)).toEqual(
      expect.arrayContaining(['/content/intro.md', '/content/runtime.md']),
    );
    expect(spec.defaultPort).not.toBe(resolveProjectSpec('vite').defaultPort);
    expect(spec.defaultPort).not.toBe(resolveProjectSpec('express-sqlite').defaultPort);
    expect(spec.defaultPort).not.toBe(resolveProjectSpec('hono-api').defaultPort);
  });
});
