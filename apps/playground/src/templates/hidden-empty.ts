import type { ViteProjectSpec } from './project-spec.ts';

/**
 * Hidden first-run workspace template. It gives the IDE a real `/scratch` owner
 * before a starter is chosen; the worker creates the root only, not these seed files.
 */
export const HIDDEN_EMPTY_TEMPLATE: ViteProjectSpec = {
  id: 'hidden-empty',
  displayName: 'Empty workspace',
  runtime: 'vite',
  install: {},
  entry: { relativePath: '/src/main.js', content: '' },
  defaultPort: 5174,
  estimatedBootSeconds: 0,
  htmlTitle: 'rifty empty workspace',
};
