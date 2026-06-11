import { describe, expect, it } from 'vitest';
import {
  type ProjectSpec,
  buildProjectPackageJson,
  resolveBootstrapConfig,
} from './project-spec.ts';
import { VITE_TEMPLATE } from './vite.ts';

describe('resolveBootstrapConfig', () => {
  it('maps a ProjectSpec + port + root to the concrete install/server config', () => {
    const cfg = resolveBootstrapConfig(VITE_TEMPLATE, 5174, '/workspace');

    expect(cfg.entryPath).toBe('/workspace/src/main.js');
    expect(cfg.installDeps).toEqual({ vite: '^5.4.0' });
    expect(cfg.runtimeSpecifier).toBe('vite');
    expect(cfg.server.appType).toBe('spa');
    expect(cfg.server.optimizeDepsDisabled).toBe(true);
    expect(cfg.hmrEnabled).toBe(true);

    const pkg = JSON.parse(cfg.packageJson) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
      type: string;
      private: boolean;
    };
    expect(pkg.scripts).toEqual({ dev: 'vite', vite: 'vite' });
    expect(pkg.dependencies).toEqual(VITE_TEMPLATE.install);
    expect(pkg.type).toBe('module');
    expect(pkg.private).toBe(true);
  });

  it('uses the shared package.json builder for bootstrap package.json', () => {
    const cfg = resolveBootstrapConfig(VITE_TEMPLATE, 5174, '/workspace');
    const packageJson = buildProjectPackageJson(VITE_TEMPLATE).json;

    expect(cfg.packageJson).toBe(packageJson);
    expect(cfg.seedFiles['/workspace/package.json']).toBe(packageJson);
  });

  it('honours a non-default port and root (not spec.defaultPort / not /workspace)', () => {
    const cfg = resolveBootstrapConfig(VITE_TEMPLATE, 5999, '/proj');
    expect(cfg.port).toBe(5999);
    expect(cfg.entryPath).toBe('/proj/src/main.js');
  });

  it('does not keep the placeholder heading in generated preview HTML', () => {
    const cfg = resolveBootstrapConfig(VITE_TEMPLATE, 5174, '/workspace');
    expect(cfg.seedFiles['/workspace/index.html']).not.toContain('Hello from rifty');
  });

  it('seeds index.html + entry + package.json, with index.html script src DERIVED from the entry', () => {
    // A non-default entry path exercises the drift failure mode: a hardcoded
    // '/src/main.js' in index.html would slip through; the seeded HTML must
    // follow the declared entry.
    const custom: ProjectSpec = {
      ...VITE_TEMPLATE,
      entry: { relativePath: '/src/app.tsx', content: VITE_TEMPLATE.entry.content },
    };
    const cfg = resolveBootstrapConfig(custom, 5174, '/workspace');

    // entry file seeded at the (non-default) entry path
    expect(cfg.seedFiles['/workspace/src/app.tsx']).toBeDefined();

    // index.html script src follows the entry, not the default main.js
    const html = cfg.seedFiles['/workspace/index.html'] ?? '';
    expect(html).toContain('src="src/app.tsx"');
    expect(html).not.toContain('src="/src/app.tsx"');
    expect(html).not.toContain('/src/main.js');

    // package.json dependencies stay in lockstep with spec.install
    const pkg = JSON.parse(cfg.seedFiles['/workspace/package.json'] ?? '{}') as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.scripts).toEqual({ dev: 'vite', vite: 'vite' });
    expect(pkg.dependencies).toEqual(custom.install);
  });
});
