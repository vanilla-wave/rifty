import { isAbsolute, normalizePath } from '@riftydev/vfs';
import type { InspectedProjectDefinition } from '../workbench/project-definition.ts';
import type { OwnerPackageConfig } from './owner-package-state.ts';

const decoder = new TextDecoder('utf-8', { fatal: true });
const DEFAULT_VITE_PORT = 5173;

function stringMap(value: unknown, field: string): Readonly<Record<string, string>> {
  if (value === undefined) return Object.freeze({});
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Workbench ${field} must be an object`);
  }
  const result: Record<string, string> = {};
  for (const [name, version] of Object.entries(value)) {
    if (name.length === 0 || typeof version !== 'string' || version.length === 0) {
      throw new TypeError(`Workbench ${field}.${name || '<empty>'} must be a non-empty string`);
    }
    result[name] = version;
  }
  return Object.freeze(result);
}

function manifestFrom(definition: InspectedProjectDefinition): {
  readonly text: string;
  readonly value: Record<string, unknown>;
} {
  const bytes = definition.files['/package.json'];
  if (bytes === undefined) {
    throw new TypeError('Workbench Vite definition is missing normalized /package.json');
  }
  let text: string;
  let value: unknown;
  try {
    text = decoder.decode(bytes);
    value = JSON.parse(text);
  } catch (error) {
    throw new TypeError(
      `Workbench /package.json is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Workbench /package.json must contain an object');
  }
  return { text, value: value as Record<string, unknown> };
}

/** Exact package-authority view of one owner-revalidated Workbench definition. */
export function workbenchPackageConfig(
  definition: InspectedProjectDefinition,
  projectRoot: string,
): OwnerPackageConfig {
  if (
    !isAbsolute(projectRoot) ||
    projectRoot === '/' ||
    normalizePath(projectRoot) !== projectRoot
  ) {
    throw new TypeError('Workbench package root must be an absolute normalized owner path');
  }
  const manifest = manifestFrom(definition);
  const name =
    typeof manifest.value.name === 'string' && manifest.value.name.length > 0
      ? manifest.value.name
      : `rifty-workbench-${definition.storageSegment}`;
  const version =
    typeof manifest.value.version === 'string' && manifest.value.version.length > 0
      ? manifest.value.version
      : '0.0.0';

  return Object.freeze({
    cfg: Object.freeze({
      runtime: 'vite' as const,
      root: projectRoot,
      port: DEFAULT_VITE_PORT,
      entryPath: `${projectRoot}/index.html`,
      packageName: name,
      packageVersion: version,
      installDeps: stringMap(manifest.value.dependencies, 'package.json dependencies'),
      packageJson: manifest.text,
      // The materializer already owns the complete project tree. Template
      // reassertion may touch only explicit node_modules seeds; Workbench has none.
      seedFiles: Object.freeze({}),
    }),
    templateId: definition.id,
    slug: definition.storageSegment,
    fromScratch: true,
  });
}
