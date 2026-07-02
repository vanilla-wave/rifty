import { describe, expect, it } from 'vitest';
import { resolveBootstrapConfig } from '../../../apps/playground/src/templates/project-spec.ts';
import { templateSpec, templateWorkspaceFiles } from './templates.ts';

describe('templateWorkspaceFiles', () => {
  it('matches the playground seed mapping exactly, minus fake .git internals', () => {
    for (const id of ['react-vite', 'hono-api'] as const) {
      const spec = templateSpec(id);
      const seeded = resolveBootstrapConfig(spec, spec.defaultPort, '').seedFiles;
      const tree = templateWorkspaceFiles(id);
      for (const [absPath, content] of Object.entries(seeded)) {
        if (absPath === '/.git/HEAD' || absPath === '/.git/config') {
          expect(tree[absPath.replace(/^\//, '')], `${id} ${absPath}`).toBeUndefined();
        } else {
          expect(tree[absPath.replace(/^\//, '')], `${id} ${absPath}`).toBe(content);
        }
      }
      // nothing extra invented
      expect(Object.keys(tree).length).toBe(Object.keys(seeded).length - 2);
    }
  });

  it('react-vite tree contains the entry, package.json and the planted-date data', () => {
    const tree = templateWorkspaceFiles('react-vite');
    expect(tree['src/main.tsx']).toBeDefined();
    expect(tree['package.json']).toContain('"react"');
    // fix-date-sort planted bug: non-zero-padded dates must be present in the seed data
    expect(tree['src/data/issues.ts']).toContain("'2025-9-14'");
  });

  it('hono-api tree contains the node entry and public assets', () => {
    const tree = templateWorkspaceFiles('hono-api');
    expect(tree['src/main.js']).toContain('@hono/node-server');
    expect(tree['public/index.html']).toBeDefined();
  });

  it('throws on an unknown template id', () => {
    expect(() => templateSpec('nope' as never)).toThrow(/unknown template/);
  });
});
