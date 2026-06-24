import { NotImplementedError } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATE_ID, defaultProjectSpec, resolveProjectSpec } from './registry.ts';

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
    expect(spec.sqlite).toBe(true);
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
    expect(spec.sqlite).toBe(false);
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
});
