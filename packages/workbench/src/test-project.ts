import type { WorkbenchProjectCatalog, WorkbenchStarter } from './project-catalog.ts';
import type { NodeCliProjectSpec, ViteProjectSpec } from './project-spec.ts';

export const TEST_VITE_TEMPLATE: ViteProjectSpec = {
  id: 'vite',
  displayName: 'Vite',
  runtime: 'vite',
  runtimeSpecifier: 'vite',
  install: {},
  entry: { relativePath: '/src/main.js', content: 'template\n' },
  defaultPort: 5174,
  estimatedBootSeconds: 1,
  htmlTitle: 'Test',
  server: {
    appType: 'spa',
    strictPort: true,
    optimizeDepsDisabled: true,
    host: false,
    allowedHosts: true,
  },
  hmr: { enabled: true },
};

export const TEST_CLI_TEMPLATE: NodeCliProjectSpec = {
  id: 'cli-report',
  displayName: 'CLI report',
  runtime: 'node-cli',
  install: {},
  entry: { relativePath: '/src/cli.js', content: "console.log('done')\n" },
  defaultPort: 0,
  estimatedBootSeconds: 0,
  extraFiles: { '/data/packages.yml': 'packages: []\n' },
};

export const TEST_HIDDEN_TEMPLATE: ViteProjectSpec = {
  ...TEST_VITE_TEMPLATE,
  id: 'hidden-empty',
  displayName: 'Empty workspace',
  entry: { relativePath: '/src/main.js', content: '' },
  hmr: { enabled: false },
};

const starters: readonly WorkbenchStarter[] = ['project-files', 'node-worker'].map((id) => ({
  id,
  name: id,
  templateId: 'vite',
  files: [{ path: 'src/main.js', content: `${id}\n` }],
}));

export const TEST_PROJECT_CATALOG: WorkbenchProjectCatalog = {
  defaultTemplateId: 'vite',
  defaultStarterId: 'project-files',
  templates: [TEST_VITE_TEMPLATE],
  starters,
};

export function testStarterById(id: string): WorkbenchStarter {
  const starter = TEST_PROJECT_CATALOG.starters.find((candidate) => candidate.id === id);
  if (!starter) throw new Error(`unknown test starter ${id}`);
  return starter;
}
