import { dirname } from '@riftydev/vfs';
import type {
  ProjectMaterializationOwner,
  ProjectMaterializationRecord,
} from '../workbench/project-materialization.ts';
import type { OwnerVfsAuthority } from './owner-vfs-authority.ts';

const ROOT = '/.rifty/workbench/v1';
const PROJECTS_ROOT = `${ROOT}/projects`;
const STAGES_ROOT = `${ROOT}/stages`;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

interface ProjectMetadata {
  readonly version: 1;
  readonly projectKey: string;
  readonly definitionIdentity: string;
}

interface Stage {
  readonly id: string;
  readonly projectKey: string;
  readonly container: string;
  readonly tree: string;
}

export interface WorkbenchProjectStoreOptions {
  readonly createStageId?: () => string;
}

function defaultStageId(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('Workbench project staging requires cryptographic randomUUID support');
  }
  return globalThis.crypto.randomUUID();
}

function assertProjectKey(value: string): string {
  const plain =
    /^[A-Za-z0-9._-]+$/.test(value) && value !== '.' && value !== '..' && !value.startsWith('~');
  const escaped = /^~(?:[0-9a-f]{4})+$/.test(value);
  if (!plain && !escaped) throw new TypeError(`Invalid Workbench project key: ${value}`);
  return value;
}

function assertDefinitionIdentity(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('Workbench project definition identity must be non-empty');
  }
  return value;
}

function assertProjectPath(value: string): string {
  if (!value.startsWith('/') || value === '/' || value.includes('\0')) {
    throw new TypeError(`Workbench stage file must use a project-rooted path: ${value}`);
  }
  const segments = value.split('/');
  if (
    segments.some(
      (segment, index) => index > 0 && (segment === '' || segment === '.' || segment === '..'),
    )
  ) {
    throw new TypeError(`Workbench stage file must use a normalized project-rooted path: ${value}`);
  }
  if (value === '/.rifty' || value.startsWith('/.rifty/')) {
    throw new TypeError(`Workbench stage file uses reserved project metadata: ${value}`);
  }
  return value;
}

function projectContainer(projectKey: string): string {
  return `${PROJECTS_ROOT}/${assertProjectKey(projectKey)}`;
}

function projectRoot(projectKey: string): string {
  return `${projectContainer(projectKey)}/tree`;
}

function metadataPath(container: string): string {
  return `${container}/definition.json`;
}

function stageProjectRoot(projectKey: string): string {
  return `${STAGES_ROOT}/${assertProjectKey(projectKey)}`;
}

function exactMetadata(value: unknown, expectedProjectKey: string): ProjectMetadata {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Workbench project ${expectedProjectKey} metadata must be an object`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== 'definitionIdentity' ||
    keys[1] !== 'projectKey' ||
    keys[2] !== 'version' ||
    record.version !== 1 ||
    record.projectKey !== expectedProjectKey ||
    typeof record.definitionIdentity !== 'string' ||
    record.definitionIdentity.length === 0
  ) {
    throw new TypeError(`Workbench project ${expectedProjectKey} metadata is invalid`);
  }
  return {
    version: 1,
    projectKey: expectedProjectKey,
    definitionIdentity: record.definitionIdentity,
  };
}

function persistFailureMessage(total: number, failures: readonly { readonly message: string }[]) {
  const sample = failures[0]?.message;
  return `${String(total)} unhealed persistence failure(s)${sample ? `: ${sample}` : ''}`;
}

/** Owner-realm durable project tree; raw VFS authority never crosses this seam. */
export function createWorkbenchProjectStore(
  authority: OwnerVfsAuthority,
  options: WorkbenchProjectStoreOptions = {},
): ProjectMaterializationOwner {
  const createStageId = options.createStageId ?? defaultStageId;
  const stages = new Map<string, Stage>();

  const discardStage = async (projectKey: string): Promise<void> => {
    const root = stageProjectRoot(projectKey);
    authority.rmSync(root, { recursive: true, force: true });
    for (const [stageId, stage] of stages) {
      if (stage.projectKey === projectKey) stages.delete(stageId);
    }
  };

  return Object.freeze({
    async readProject(projectKey: string): Promise<ProjectMaterializationRecord | null> {
      const key = assertProjectKey(projectKey);
      const container = projectContainer(key);
      const stat = authority.statSyncOrNull(container);
      if (stat === null) return null;
      if (!stat.isDirectory) {
        throw new TypeError(`Workbench project ${key} container is not a directory`);
      }
      const metadataFile = metadataPath(container);
      if (authority.statSyncOrNull(metadataFile)?.isFile !== true) {
        throw new TypeError(`Workbench project ${key} metadata is missing`);
      }
      const tree = projectRoot(key);
      if (authority.statSyncOrNull(tree)?.isDirectory !== true) {
        throw new TypeError(`Workbench project ${key} tree is missing`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(decoder.decode(authority.readFileBytesSync(metadataFile)));
      } catch (error) {
        throw new TypeError(
          `Workbench project ${key} metadata is unreadable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      const metadata = exactMetadata(parsed, key);
      return Object.freeze({
        definitionIdentity: metadata.definitionIdentity,
        projectRoot: tree,
        revision: authority.treeRevision,
      });
    },

    discardStage,

    async beginStage(projectKey: string): Promise<{ readonly stageId: string }> {
      const key = assertProjectKey(projectKey);
      await discardStage(key);
      const id = createStageId();
      if (typeof id !== 'string' || id.length === 0 || !/^[A-Za-z0-9-]+$/.test(id)) {
        throw new TypeError('Workbench stage id must be a non-empty alphanumeric token');
      }
      if (stages.has(id)) throw new Error(`Workbench stage id collision: ${id}`);
      const container = `${stageProjectRoot(key)}/${id}`;
      const tree = `${container}/tree`;
      authority.mkdirSync(tree, { recursive: true });
      stages.set(id, Object.freeze({ id, projectKey: key, container, tree }));
      return Object.freeze({ stageId: id });
    },

    async writeStageFile(stageId: string, path: string, bytes: Uint8Array): Promise<void> {
      const stage = stages.get(stageId);
      if (stage === undefined) throw new Error(`Unknown Workbench stage: ${stageId}`);
      const relative = assertProjectPath(path);
      const target = `${stage.tree}${relative}`;
      authority.mkdirSync(dirname(target), { recursive: true });
      authority.writeFileSync(target, bytes.slice());
    },

    async promoteStage(input: Parameters<ProjectMaterializationOwner['promoteStage']>[0]) {
      const stage = stages.get(input.stageId);
      if (stage === undefined) throw new Error(`Unknown Workbench stage: ${input.stageId}`);
      const key = assertProjectKey(input.projectKey);
      if (stage.projectKey !== key) {
        throw new Error(
          `Workbench stage ${input.stageId} belongs to project ${stage.projectKey}, not ${key}`,
        );
      }
      const target = projectContainer(key);
      if (authority.statSyncOrNull(target) !== null) {
        throw new Error(`Workbench project ${key} already exists during stage promotion`);
      }
      const metadata: ProjectMetadata = {
        version: 1,
        projectKey: key,
        definitionIdentity: assertDefinitionIdentity(input.definitionIdentity),
      };
      authority.writeFileSync(
        metadataPath(stage.container),
        encoder.encode(`${JSON.stringify(metadata)}\n`),
      );
      authority.mkdirSync(PROJECTS_ROOT, { recursive: true });
      authority.renameSync(stage.container, target);
      stages.delete(stage.id);
      return Object.freeze({ projectRoot: projectRoot(key), revision: authority.treeRevision });
    },

    async deleteProject(projectKey: string): Promise<{ readonly revision: number }> {
      const key = assertProjectKey(projectKey);
      await discardStage(key);
      authority.rmSync(projectContainer(key), { recursive: true, force: true });
      return Object.freeze({ revision: authority.treeRevision });
    },

    async waitForDurability(revision: number): Promise<void> {
      if (!Number.isSafeInteger(revision) || revision < 0 || revision > authority.treeRevision) {
        throw new RangeError(
          `Workbench durability revision ${String(revision)} is outside owner revision ${String(
            authority.treeRevision,
          )}`,
        );
      }
      const report = await authority.flush();
      if (report !== undefined && report.total > 0) {
        throw new Error(persistFailureMessage(report.total, report.failures));
      }
    },
  });
}
