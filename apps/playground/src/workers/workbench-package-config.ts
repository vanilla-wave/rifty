import { isAbsolute, normalizePath } from '@riftydev/vfs';
import { defineOwnEnumerableProperty } from '../workbench/internal/own-property.ts';
import type { InspectedProjectDefinition } from '../workbench/project-definition.ts';
import type { ProjectFirstMaterialization } from '../workbench/project-materialization.ts';
import type {
  FirstMaterializationOwnerPackageConfig,
  OwnerPackageConfig,
} from './owner-package-state.ts';

const decoder = new TextDecoder('utf-8', { fatal: true });
const DEFAULT_VITE_PORT = 5173;

export type FirstMaterializationProjectDefinition<TReady = unknown> =
  InspectedProjectDefinition<TReady> & {
    readonly templateId: string;
    readonly firstMaterialization: ProjectFirstMaterialization;
    readonly port?: number;
  };

function firstMaterializationMetadata(definition: InspectedProjectDefinition): {
  readonly templateId: string;
  readonly firstMaterialization: ProjectFirstMaterialization;
  readonly port?: number;
} | null {
  if (!Object.hasOwn(definition, 'firstMaterialization')) return null;
  const enriched = definition as InspectedProjectDefinition & Record<string, unknown>;
  if (typeof enriched.templateId !== 'string' || enriched.templateId.length === 0) {
    throw new TypeError('Workbench templateId must be a non-empty string');
  }
  const raw = enriched.firstMaterialization;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Workbench firstMaterialization must be an object');
  }
  const materialization = raw as Record<string, unknown>;
  let firstMaterialization: ProjectFirstMaterialization;
  if (materialization.kind === 'install') {
    firstMaterialization = Object.freeze({ kind: 'install' });
  } else if (materialization.kind === 'snapshot') {
    const rawSnapshot = materialization.snapshot;
    if (rawSnapshot === null || typeof rawSnapshot !== 'object' || Array.isArray(rawSnapshot)) {
      throw new TypeError('Workbench firstMaterialization.snapshot must be an object');
    }
    const snapshot = rawSnapshot as Record<string, unknown>;
    if (
      typeof snapshot.snapshotId !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/.test(snapshot.snapshotId) ||
      typeof snapshot.assetUrl !== 'string' ||
      snapshot.assetUrl.length === 0 ||
      typeof snapshot.templateId !== 'string' ||
      snapshot.templateId.length === 0
    ) {
      throw new TypeError('Workbench dependency snapshot descriptor is invalid');
    }
    firstMaterialization = Object.freeze({
      kind: 'snapshot',
      snapshot: Object.freeze({
        snapshotId: snapshot.snapshotId,
        assetUrl: snapshot.assetUrl,
        templateId: snapshot.templateId,
      }),
    });
  } else {
    throw new TypeError('Workbench firstMaterialization.kind is invalid');
  }
  const port = enriched.port;
  if (
    port !== undefined &&
    (!Number.isSafeInteger(port) || (port as number) < 1 || (port as number) > 65_535)
  ) {
    throw new TypeError('Workbench port must be an integer from 1 to 65535');
  }
  return {
    templateId: enriched.templateId,
    firstMaterialization,
    ...(port === undefined ? {} : { port: port as number }),
  };
}

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
    defineOwnEnumerableProperty(result, name, version);
  }
  return Object.freeze(result);
}

function manifestFrom(definition: InspectedProjectDefinition): {
  readonly text: string;
  readonly value: Record<string, unknown>;
} {
  const bytes = definition.files['/package.json'];
  if (bytes === undefined) {
    throw new TypeError('Workbench definition is missing normalized /package.json');
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
  definition: FirstMaterializationProjectDefinition,
  projectRoot: string,
): FirstMaterializationOwnerPackageConfig;
export function workbenchPackageConfig(
  definition: InspectedProjectDefinition,
  projectRoot: string,
): OwnerPackageConfig;
export function workbenchPackageConfig(
  definition: InspectedProjectDefinition,
  projectRoot: string,
): OwnerPackageConfig | FirstMaterializationOwnerPackageConfig {
  if (
    !isAbsolute(projectRoot) ||
    projectRoot === '/' ||
    normalizePath(projectRoot) !== projectRoot
  ) {
    throw new TypeError('Workbench package root must be an absolute normalized owner path');
  }
  const manifest = manifestFrom(definition);
  const metadata = firstMaterializationMetadata(definition);
  const name =
    typeof manifest.value.name === 'string' && manifest.value.name.length > 0
      ? manifest.value.name
      : `rifty-workbench-${definition.storageSegment}`;
  const version =
    typeof manifest.value.version === 'string' && manifest.value.version.length > 0
      ? manifest.value.version
      : '0.0.0';

  const base = {
    root: projectRoot,
    packageName: name,
    packageVersion: version,
    installDeps: stringMap(manifest.value.dependencies, 'package.json dependencies'),
    packageJson: manifest.text,
    // The materializer already owns the complete project tree. Definition
    // registration may touch only explicit node_modules seeds; Workbench has none.
    seedFiles: Object.freeze({}),
  };
  const cfg =
    definition.kind === 'node-server'
      ? Object.freeze({
          ...base,
          runtime: 'node-server' as const,
          port: definition.port,
          entryPath: `${projectRoot}${definition.entryPath}`,
        })
      : definition.kind === 'node-cli'
        ? Object.freeze({
            ...base,
            runtime: 'node-cli' as const,
            entryPath: `${projectRoot}${definition.entryPath}`,
          })
        : Object.freeze({
            ...base,
            runtime: 'vite' as const,
            port: metadata?.port ?? DEFAULT_VITE_PORT,
            entryPath: `${projectRoot}/index.html`,
          });

  return Object.freeze({
    cfg,
    templateId: metadata?.templateId ?? definition.id,
    slug: definition.storageSegment,
    fromScratch: true,
    ...(metadata ? { firstMaterialization: metadata.firstMaterialization } : {}),
  });
}

/** Companion-only boundary: first materialization metadata is mandatory, never inferred. */
export function workbenchFirstMaterializationPackageConfig(
  definition: InspectedProjectDefinition,
  projectRoot: string,
): FirstMaterializationOwnerPackageConfig {
  const config = workbenchPackageConfig(definition, projectRoot);
  if (!Object.hasOwn(config, 'firstMaterialization')) {
    throw new TypeError('Playground definition is missing first-materialization metadata');
  }
  return config as FirstMaterializationOwnerPackageConfig;
}
