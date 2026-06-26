import { describe, expect, it } from 'vitest';
import {
  type NodeServerProjectSpec,
  type ProjectSpec,
  buildProjectPackageJson,
  devScriptCommand,
  isDevScriptName,
  resolveBootstrapConfig,
  terminalDevLine,
} from './project-spec.ts';
import { TYPESCRIPT_TEMPLATE } from './typescript.ts';
import { VITE_TEMPLATE } from './vite.ts';
import { VITE8_TEMPLATE } from './vite8.ts';

const NODE_FIXTURE: NodeServerProjectSpec = {
  id: 'node-fixture',
  displayName: 'Node fixture',
  runtime: 'node-server',
  install: { express: '^4.19.0' },
  entry: { relativePath: '/src/main.js', content: 'console.log("server")\n' },
  defaultPort: 3210,
  estimatedBootSeconds: 15,
  sqlite: true,
  extraFiles: {
    '/public/index.html': '<!doctype html><title>fixture</title>\n',
    '/public/client.js': 'console.log("client")\n',
  },
};

describe('resolveBootstrapConfig', () => {
  it('maps a ProjectSpec + port + root to the concrete install/server config', () => {
    const cfg = resolveBootstrapConfig(VITE_TEMPLATE, 5174, '/workspace');
    if (cfg.runtime !== 'vite') throw new Error('expected a vite bootstrap config');

    expect(cfg.entryPath).toBe('/workspace/src/main.js');
    expect(cfg.installDeps).toEqual({ vite: '^7.0.0', '@rollup/wasm-node': '4.62.2' });
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

  it('initializes the project root as a git repository', () => {
    const cfg = resolveBootstrapConfig(VITE_TEMPLATE, 5174, '/workspace');

    expect(cfg.seedFiles['/workspace/.git/HEAD']).toBe('ref: refs/heads/main\n');
    expect(cfg.seedFiles['/workspace/.git/config']).toContain('repositoryformatversion = 0');
    expect(cfg.seedFiles['/workspace/.git/config']).toContain('bare = false');
    expect(cfg.seedFiles['/workspace/.gitignore']).toContain('node_modules/');
    expect(cfg.seedFiles['/workspace/.gitignore']).toContain('dist/');
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

  it('seeds a self-accepting entry so real Vite can patch the module in place', () => {
    expect(VITE_TEMPLATE.entry.content).toContain('import.meta.hot.accept');
    expect(VITE_TEMPLATE.entry.content).toContain('next?.render()');
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

    // Dark bg painted from the first frame: Vite can still full-reload
    // non-HMR-able boundaries before entry JS gets to style the body.
    expect(html).toContain('background:#101218');

    // package.json dependencies stay in lockstep with spec.install
    const pkg = JSON.parse(cfg.seedFiles['/workspace/package.json'] ?? '{}') as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.scripts).toEqual({ dev: 'vite', vite: 'vite' });
    expect(pkg.dependencies).toEqual(custom.install);
  });

  it('seeds vite template extra files alongside a TypeScript entry', () => {
    const cfg = resolveBootstrapConfig(TYPESCRIPT_TEMPLATE, 5174, '/workspace');

    expect(cfg.entryPath).toBe('/workspace/src/main.ts');
    expect(cfg.seedFiles['/workspace/index.html']).toContain('src="src/main.ts"');
    expect(cfg.seedFiles['/workspace/src/main.ts']).toBe(TYPESCRIPT_TEMPLATE.entry.content);
    expect(cfg.seedFiles['/workspace/tsconfig.json']).toContain('"strict": true');
    expect(cfg.seedFiles['/workspace/src/model.ts']).toContain('export interface Widget');
    expect(cfg.seedFiles['/workspace/node_modules/@rifty/example-types/index.d.ts']).toContain(
      'declare module',
    );
  });

  it('declares TypeScript starter TypeScript as a project-owned dev dependency', () => {
    const spec: ProjectSpec = TYPESCRIPT_TEMPLATE;
    const cfg = resolveBootstrapConfig(TYPESCRIPT_TEMPLATE, 5174, '/workspace');
    const pkg = JSON.parse(cfg.packageJson) as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(TYPESCRIPT_TEMPLATE.install).toEqual(VITE_TEMPLATE.install);
    expect(pkg.dependencies).toEqual(VITE_TEMPLATE.install);
    expect(pkg.devDependencies).toEqual({ typescript: '5.9.3' });
    expect(TYPESCRIPT_TEMPLATE.bakedNodeModulesUrl).toBe(
      '/snapshots/typescript-node-modules.json.gz',
    );
    expect(spec.bakedNodeModulesTemplateId).toBeUndefined();
    expect(cfg.bakedNodeModulesTemplateId).toBeUndefined();
  });
});

describe('resolveBootstrapConfig (node-server runtime)', () => {
  it('seeds entry + package.json + extraFiles and does NOT seed index.html', () => {
    const cfg = resolveBootstrapConfig(NODE_FIXTURE, 3210, '/workspace');

    expect(cfg.seedFiles['/workspace/.git/HEAD']).toBe('ref: refs/heads/main\n');
    expect(cfg.seedFiles['/workspace/.git/config']).toContain('repositoryformatversion = 0');
    expect(cfg.seedFiles['/workspace/.git/config']).toContain('bare = false');
    expect(cfg.seedFiles['/workspace/.gitignore']).toContain('node_modules/');
    expect(cfg.seedFiles['/workspace/.gitignore']).toContain('dist/');
    expect(cfg.seedFiles['/workspace/src/main.js']).toBe(NODE_FIXTURE.entry.content);
    expect(cfg.seedFiles['/workspace/package.json']).toBe(cfg.packageJson);
    expect(cfg.seedFiles['/workspace/public/index.html']).toBe(
      NODE_FIXTURE.extraFiles['/public/index.html'],
    );
    expect(cfg.seedFiles['/workspace/public/client.js']).toBe(
      NODE_FIXTURE.extraFiles['/public/client.js'],
    );
    // A node server serves its own HTML; a seeded SPA index.html would shadow it.
    expect(cfg.seedFiles['/workspace/index.html']).toBeUndefined();
  });

  it('tolerates extraFiles keys without a leading slash (no silent root-sibling seed)', () => {
    const cfg = resolveBootstrapConfig(
      { ...NODE_FIXTURE, extraFiles: { 'public/no-slash.txt': 'x' } },
      3210,
      '/workspace',
    );
    expect(cfg.seedFiles['/workspace/public/no-slash.txt']).toBe('x');
    expect(cfg.seedFiles['/workspacepublic/no-slash.txt']).toBeUndefined();
  });

  it('builds package.json with node scripts derived from the entry path', () => {
    const cfg = resolveBootstrapConfig(NODE_FIXTURE, 3210, '/workspace');
    const pkg = JSON.parse(cfg.packageJson) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      type: string;
    };
    expect(pkg.scripts).toEqual({ dev: 'node src/main.js', start: 'node src/main.js' });
    expect(pkg.dependencies).toEqual(NODE_FIXTURE.install);
    expect(pkg.type).toBe('module');
  });

  it('carries the runtime discriminant + sqlite flag for the worker branch', () => {
    const cfg = resolveBootstrapConfig(NODE_FIXTURE, 3210, '/workspace');
    expect(cfg.runtime).toBe('node-server');
    if (cfg.runtime !== 'node-server') throw new Error('unreachable');
    expect(cfg.sqlite).toBe(true);
  });

  it('keeps the vite runtime discriminant on the vite config', () => {
    const cfg = resolveBootstrapConfig(VITE_TEMPLATE, 5174, '/workspace');
    expect(cfg.runtime).toBe('vite');
  });
});

describe('vite8 opt-in preset', () => {
  it('is a distinct vite spec pinned to Vite 8 with its own baked snapshot', () => {
    expect(VITE8_TEMPLATE.id).toBe('vite8');
    expect(VITE8_TEMPLATE.runtime).toBe('vite');
    expect(VITE8_TEMPLATE.install).toEqual({ vite: '8.0.16' });
    expect(VITE8_TEMPLATE.bakedNodeModulesUrl).toBe('/snapshots/vite8-node-modules.json.gz');
    expect(VITE_TEMPLATE.bakedNodeModulesUrl).not.toBe(VITE8_TEMPLATE.bakedNodeModulesUrl);
  });

  it('keeps HMR disabled for the Vite 8 Rolldown path (ADR-0161)', () => {
    const cfg = resolveBootstrapConfig(VITE8_TEMPLATE, 5174, '/workspace');
    if (cfg.runtime !== 'vite') throw new Error('expected a vite bootstrap config');
    expect(cfg.hmrEnabled).toBe(false);
  });
});

describe('terminal dev command derivation', () => {
  it('boots vite templates through the real vite CLI pinned to the template port', () => {
    expect(terminalDevLine(VITE_TEMPLATE, '/workspace')).toBe(
      'vite --host 0.0.0.0 --strictPort --port 5174',
    );
  });

  it("boots node-server templates through 'npm run dev' pinned to the project root", () => {
    // cd-prefixed: `npm run` reads package.json from the SESSION cwd, which a
    // persisted terminal may have left outside the project.
    expect(terminalDevLine(NODE_FIXTURE, '/workspace')).toBe('cd /workspace && npm run dev');
  });

  it('derives the package.json dev script from the entry for node-server', () => {
    expect(devScriptCommand(NODE_FIXTURE)).toBe('node src/main.js');
    expect(devScriptCommand(VITE_TEMPLATE)).toBe('vite');
  });
});

describe('isDevScriptName (page-realm dev-line matcher)', () => {
  it('recognises the spec dev-line NAMES so they boot the co-resident dev server', () => {
    expect(isDevScriptName(VITE_TEMPLATE, 'dev')).toBe(true);
    expect(isDevScriptName(VITE_TEMPLATE, 'vite')).toBe(true);
    expect(isDevScriptName(NODE_FIXTURE, 'dev')).toBe(true);
    expect(isDevScriptName(NODE_FIXTURE, 'start')).toBe(true);
  });

  it('matches by NAME, not command — `npm run dev` boots even with a stale package.json command', () => {
    // The e2e regression (fullstack-demo): command-string matching rejected
    // `npm run dev` on a node preset whose on-disk package.json `dev` was still
    // the default vite preset's `vite` command — so the node server never booted.
    // Name-based matching is immune: `dev` is the dev line regardless of command.
    expect(isDevScriptName(NODE_FIXTURE, 'dev')).toBe(true);
  });

  it('rejects an arbitrary user script (e.g. `npm run build`) — must not boot dev', () => {
    // The #1 bug: a user-added script silently booted the dev server and exited 0.
    // Names the playground never seeds as a dev alias are NOT the dev line.
    expect(isDevScriptName(VITE_TEMPLATE, 'build')).toBe(false);
    expect(isDevScriptName(VITE_TEMPLATE, 'lint')).toBe(false);
    expect(isDevScriptName(VITE_TEMPLATE, 'start')).toBe(false); // vite seeds dev/vite, not start
    expect(isDevScriptName(NODE_FIXTURE, 'build')).toBe(false);
    expect(isDevScriptName(NODE_FIXTURE, '')).toBe(false);
  });
});
