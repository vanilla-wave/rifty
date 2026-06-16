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
});
