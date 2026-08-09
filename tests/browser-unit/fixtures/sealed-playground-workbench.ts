import type { ProcessExit } from '@riftydev/shell';
import { OpfsVfs } from '@riftydev/vfs';
import {
  type PlaygroundProjectPlan,
  type PlaygroundSessionTools,
  type PlaygroundWorkbench,
  openPlaygroundWorkbench,
} from '../../../apps/playground/src/browser-unit/workbench-playground-entry.ts';
import type {
  ProjectDefinition,
  ProjectSession,
  ProjectTerminal,
} from '../../../apps/playground/src/browser-unit/workbench-public-entry.ts';
import type { ProjectSpec } from '../../../apps/playground/src/templates/project-spec.ts';

export interface SealedWorkbenchBootOptions {
  readonly workspaceId: string;
  readonly template?: 'hidden-empty' | 'typescript' | 'vite';
  readonly root?: string;
  readonly slug?: string;
  readonly setup?: 'instant' | 'from-scratch';
  readonly starter?: string;
  readonly hiddenEmptyBoot?: boolean;
  readonly persistence?: 'required' | 'preferred' | 'ephemeral';
  readonly plan?: PlaygroundProjectPlan;
}

interface HostAssets {
  readonly workers: {
    readonly owner: string;
    readonly kernel: string;
    readonly node: string;
    readonly devServer: string;
    readonly typescript: string;
  };
  readonly wasm: { readonly sqlite: string };
}

interface ActiveFixture {
  readonly workbench: PlaygroundWorkbench;
  readonly definition: ProjectDefinition<unknown>;
  readonly project: ProjectSession<unknown>;
  readonly root: string;
  readonly baseElement: HTMLBaseElement;
  terminal: ProjectTerminal | null;
}

let active: ActiveFixture | null = null;

export interface LegacyWorkspaceSeed {
  readonly workspaceId: string;
  readonly label: string;
  readonly marker: string;
}

function legacyWorkspacePrefix(workspaceId: string): string {
  let slug = '';
  for (let index = 0; index < workspaceId.length; index += 1) {
    const codeUnit = workspaceId[index] as string;
    slug += /[A-Za-z0-9._-]/u.test(codeUnit) ? codeUnit : '_';
  }
  return `/workspaces/${slug}`;
}

function errorFrom(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function requireActive(): ActiveFixture {
  if (active === null) throw new Error('No sealed browser-unit Workbench fixture is open');
  return active;
}

function exactRoot(root: string | undefined): string {
  const value = root ?? '/scratch';
  if (!value.startsWith('/') || value.length < 2 || value.endsWith('/') || value.includes('\0')) {
    throw new TypeError('Browser-unit fixture root must be an absolute non-root path');
  }
  return value;
}

export function logicalProjectPath(path: string): string {
  const { root } = requireActive();
  if (path === root) return '/';
  if (!path.startsWith(`${root}/`)) {
    throw new TypeError(`Path ${JSON.stringify(path)} is outside sealed project root ${root}`);
  }
  return path.slice(root.length);
}

async function hostAssets(): Promise<HostAssets> {
  const url = '/src/browser-unit/workbench-vite-host-assets.ts';
  const module = await import(/* @vite-ignore */ url);
  return (module as { readonly workbenchViteHostAssets: HostAssets }).workbenchViteHostAssets;
}

async function templateSpec(
  template: SealedWorkbenchBootOptions['template'],
): Promise<ProjectSpec | null> {
  if (template === undefined || template === 'hidden-empty') return null;
  if (template === 'typescript') {
    const url = '/src/templates/typescript.ts';
    return (await import(/* @vite-ignore */ url)).TYPESCRIPT_TEMPLATE;
  }
  const url = '/src/templates/vite.ts';
  return (await import(/* @vite-ignore */ url)).VITE_TEMPLATE;
}

async function projectPlan(options: SealedWorkbenchBootOptions): Promise<PlaygroundProjectPlan> {
  if (options.plan !== undefined) return options.plan;
  const spec = await templateSpec(options.template);
  const starterId = options.starter ?? options.workspaceId;
  if (spec === null) {
    return Object.freeze({
      kind: 'node-cli' as const,
      id: 'scratch',
      starterId,
      templateId: `browser-unit:${options.workspaceId}`,
      files: Object.freeze({
        '/package.json': `${JSON.stringify({
          name: `browser-unit-${options.workspaceId}`,
          private: true,
          type: 'module',
        })}\n`,
        '/.browser-unit-noop.mjs': '',
      }),
      firstMaterialization: Object.freeze({ kind: 'install' as const }),
      entryPath: '/.browser-unit-noop.mjs',
    });
  }

  const projectSpecUrl = '/src/templates/project-spec.ts';
  const { resolveBootstrapConfig } = await import(/* @vite-ignore */ projectSpecUrl);
  const bootstrap = resolveBootstrapConfig(spec, spec.defaultPort, '');
  const snapshot =
    options.setup !== 'from-scratch' &&
    spec.bakedNodeModulesUrl !== undefined &&
    spec.bakedNodeModulesSnapshotId !== undefined
      ? Object.freeze({
          kind: 'snapshot' as const,
          snapshot: Object.freeze({
            snapshotId: spec.bakedNodeModulesSnapshotId,
            assetUrl: spec.bakedNodeModulesUrl,
            templateId: spec.bakedNodeModulesTemplateId ?? spec.id,
          }),
        })
      : Object.freeze({ kind: 'install' as const });
  const base = {
    id: 'scratch',
    starterId,
    templateId: spec.id,
    files: Object.freeze({ ...bootstrap.seedFiles }),
    dependencies: Object.freeze({ ...spec.install }),
    ...(spec.devDependencies === undefined
      ? {}
      : { devDependencies: Object.freeze({ ...spec.devDependencies }) }),
    firstMaterialization: snapshot,
  };
  if (spec.runtime === 'vite') {
    return Object.freeze({ ...base, kind: 'vite' as const, port: spec.defaultPort });
  }
  if (spec.runtime === 'node-server') {
    return Object.freeze({
      ...base,
      kind: 'node-server' as const,
      entryPath: spec.entry.relativePath,
      port: spec.defaultPort,
    });
  }
  return Object.freeze({
    ...base,
    kind: 'node-cli' as const,
    entryPath: spec.entry.relativePath,
  });
}

export async function openSealedWorkbenchFixture(
  options: SealedWorkbenchBootOptions,
): Promise<void> {
  if (active !== null) await closeSealedWorkbenchFixture();
  const [assets, plan] = await Promise.all([hostAssets(), projectPlan(options)]);
  const ownerWorkerUrl = new URL(assets.workers.owner, location.href);
  const ownerWorkerBaseUrl = new URL('.', ownerWorkerUrl);
  const ownerWorkerReference = ownerWorkerUrl.href.slice(ownerWorkerBaseUrl.href.length);
  const baseElement = document.createElement('base');
  baseElement.href = ownerWorkerBaseUrl.href;
  document.head.prepend(baseElement);

  let workbench: PlaygroundWorkbench | null = null;
  let project: ProjectSession<unknown> | null = null;
  try {
    workbench = await openPlaygroundWorkbench({
      deployment: {
        workers: { ...assets.workers, owner: ownerWorkerReference },
        serviceWorker: { url: '/sw.js', scope: '/' },
        wasm: assets.wasm,
        previewProbeTimeoutMs: 30_000,
      },
      packageAcquisition: { registryUrl: '/npm-registry' },
      storage: { persistence: options.persistence ?? 'ephemeral' },
    });
    const definition = workbench.playground.define(plan);
    await workbench.playground.catalog.createScratch({
      definition,
      preserveDirtySameStarter: true,
    });
    project = await workbench.openProject(definition);
    active = {
      workbench,
      definition,
      project,
      root: exactRoot(options.root),
      baseElement,
      terminal: null,
    };
  } catch (error) {
    const failures: Error[] = [errorFrom(error)];
    if (project !== null) {
      try {
        await project.close();
      } catch (closeError) {
        failures.push(errorFrom(closeError));
      }
    }
    if (workbench !== null) {
      try {
        await workbench.close();
      } catch (closeError) {
        failures.push(errorFrom(closeError));
      }
    }
    baseElement.remove();
    if (failures.length === 1) throw failures[0];
    throw new AggregateError(failures, 'Sealed browser-unit Workbench fixture open failed');
  }
}

export function currentWorkbench(): PlaygroundWorkbench {
  return requireActive().workbench;
}

export function currentProject(): ProjectSession<unknown> {
  return requireActive().project;
}

export function currentTerminalSnapshot(): {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
} {
  const terminal = requireActive().terminal;
  if (terminal === null) throw new Error('No browser-unit project terminal is open');
  return terminal.snapshot();
}

export function currentSessionTools(): PlaygroundSessionTools {
  const fixture = requireActive();
  return fixture.workbench.playground.forSession(fixture.project);
}

/** Seed the historical origin layout before the extracted owner opens it. */
export async function seedLegacyWorkspace(input: LegacyWorkspaceSeed): Promise<void> {
  if (active !== null) throw new Error('Legacy workspace seeding requires no active Workbench');
  const prefix = legacyWorkspacePrefix(input.workspaceId);

  const vfs = new OpfsVfs();
  await vfs.init();
  await vfs.rm(prefix, { recursive: true, force: true });
  const write = async (path: string, content: string): Promise<void> => {
    const parent = path.slice(0, path.lastIndexOf('/')) || '/';
    await vfs.mkdir(parent, { recursive: true });
    await vfs.writeFile(path, content);
  };
  await write(
    `${prefix}/projects/project-a/package.json`,
    '{"name":"legacy-project-a","private":true,"type":"module"}\n',
  );
  await write(`${prefix}/projects/project-a/legacy-marker.txt`, `${input.marker}:a`);
  await write(
    `${prefix}/projects/project-b/package.json`,
    '{"name":"legacy-project-b","private":true,"type":"module"}\n',
  );
  await write(`${prefix}/projects/project-b/legacy-marker.txt`, `${input.marker}:b`);
  await write(
    `${prefix}/.rifty-project-index.json`,
    `${JSON.stringify({
      activeId: 'project-a',
      scratch: null,
      projects: [
        {
          id: 'project-a',
          name: `${input.label} A`,
          starter: 'starter-a',
          editedAt: '2026-07-01T01:00:00.000Z',
        },
        {
          id: 'project-b',
          name: `${input.label} B`,
          starter: 'starter-b',
          editedAt: '2026-07-02T02:00:00.000Z',
        },
      ],
    })}\n`,
  );
}

export async function executeProjectLine(
  line: string,
): Promise<{ readonly exit: number; readonly out: string }> {
  const fixture = requireActive();
  const terminal = fixture.terminal ?? fixture.project.terminals.open();
  fixture.terminal = terminal;
  let out = '';
  const detach = terminal.attach((chunk) => {
    out += chunk;
  });
  try {
    const run = terminal.run(line);
    const exit = await run.exited;
    const closed = await run.close();
    if (closed.code !== exit.code || closed.signal !== exit.signal) {
      throw new Error('Project terminal run close changed its exit outcome');
    }
    if (exit.code === null) {
      throw new Error(`Project terminal command exited by signal ${String(exit.signal)}`);
    }
    return Object.freeze({ exit: exit.code, out });
  } finally {
    detach();
  }
}

export async function executeProjectLineOutcome(line: string): Promise<{
  readonly exitCode: number;
  readonly exit: ProcessExit;
  readonly closeExit: ProcessExit;
  readonly closeShared: boolean;
  readonly settlements: number;
  readonly out: string;
}> {
  const fixture = requireActive();
  const terminal = fixture.terminal ?? fixture.project.terminals.open();
  fixture.terminal = terminal;
  let out = '';
  let settlements = 0;
  const detach = terminal.attach((chunk) => {
    out += chunk;
  });
  try {
    const run = terminal.run(line);
    const exited = run.exited.then((exit) => {
      settlements += 1;
      return exit;
    });
    const [exitCode, exit] = await Promise.all([run.exitCode, exited]);
    const closing = run.close();
    const repeatedClose = run.close();
    const closeExit = await closing;
    await Promise.resolve();
    return Object.freeze({
      exitCode,
      exit,
      closeExit,
      closeShared: closing === repeatedClose,
      settlements,
      out,
    });
  } finally {
    detach();
  }
}

export async function executeProjectLineUntil(
  line: string,
  marker: string,
): Promise<{ readonly exit: ProcessExit; readonly out: string }> {
  const fixture = requireActive();
  const terminal = fixture.terminal ?? fixture.project.terminals.open();
  fixture.terminal = terminal;
  let out = '';
  let resolveMarker!: () => void;
  const markerSeen = new Promise<void>((resolve) => {
    resolveMarker = resolve;
  });
  const detach = terminal.attach((chunk) => {
    out += chunk;
    if (out.includes(marker)) resolveMarker();
  });
  const run = terminal.run(line);
  try {
    await Promise.race([
      markerSeen,
      run.exited.then((exit) => {
        throw new Error(
          `Project terminal command exited before ${JSON.stringify(marker)}: ${JSON.stringify(exit)}\n${out}`,
        );
      }),
    ]);
    const stopped = await run.stop();
    const exited = await run.exited;
    const closed = await run.close();
    if (!sameExit(stopped, exited) || !sameExit(exited, closed)) {
      throw new Error('Project terminal stop/close changed its exit outcome');
    }
    return Object.freeze({ exit: exited, out });
  } catch (error) {
    await run.close().catch(() => {});
    throw error;
  } finally {
    detach();
  }
}

/** Consume the companion's deferred first materialization through its public run. */
export async function runDefaultProjectOnce(): Promise<ProcessExit> {
  const run = requireActive().project.run();
  try {
    await run.ready;
    const exited = await run.exited;
    const closed = await run.close();
    if (!sameExit(exited, closed)) {
      throw new Error('Default project run close changed its exit outcome');
    }
    return exited;
  } catch (error) {
    await run.close().catch(() => {});
    throw error;
  }
}

async function ensureDirectory(path: string): Promise<void> {
  if (path === '/') return;
  const fixture = requireActive();
  const parent = path.slice(0, path.lastIndexOf('/')) || '/';
  await ensureDirectory(parent);
  const name = path.slice(path.lastIndexOf('/') + 1);
  const siblings = await fixture.project.files.readdir(parent);
  const existing = siblings.find(
    (entry) => entry.path === `${parent === '/' ? '' : parent}/${name}`,
  );
  if (existing === undefined) {
    await fixture.project.files.mkdir(path, { expectedVersion: null });
    return;
  }
  if (existing.kind !== 'dir') throw new Error(`Project path ${path} is not a directory`);
}

export async function writeProjectText(path: string, content: string): Promise<void> {
  const fixture = requireActive();
  const logical = logicalProjectPath(path);
  const parent = logical.slice(0, logical.lastIndexOf('/')) || '/';
  await ensureDirectory(parent);
  const siblings = await fixture.project.files.readdir(parent);
  const existing = siblings.find((entry) => entry.path === logical);
  if (existing?.kind === 'dir') throw new Error(`Project path ${logical} is a directory`);
  await fixture.project.files.writeFile(logical, new TextEncoder().encode(content), {
    expectedVersion: existing?.version ?? null,
  });
}

export async function readProjectText(
  path: string,
): Promise<{ readonly ok: boolean; readonly text: string; readonly error: string }> {
  try {
    const read = await requireActive().project.files.readFile(logicalProjectPath(path));
    return Object.freeze({ ok: true, text: new TextDecoder().decode(read.bytes), error: '' });
  } catch (error) {
    return Object.freeze({ ok: false, text: '', error: errorFrom(error).message });
  }
}

export async function removeProjectPath(path: string, recursive = false): Promise<void> {
  const fixture = requireActive();
  const logical = logicalProjectPath(path);
  const parent = logical.slice(0, logical.lastIndexOf('/')) || '/';
  const entry = (await fixture.project.files.readdir(parent)).find(
    (candidate) => candidate.path === logical,
  );
  if (entry === undefined) throw new Error(`Project path ${logical} is absent`);
  await fixture.project.files.remove(logical, { expectedVersion: entry.version, recursive });
}

export function awaitProjectDurability(): Promise<void> {
  return currentSessionTools().awaitDurability();
}

async function closeOutcome(operation: () => Promise<unknown>, failures: Error[]): Promise<void> {
  try {
    await operation();
  } catch (error) {
    failures.push(errorFrom(error));
  }
}

export async function closeSealedWorkbenchFixture(): Promise<void> {
  const fixture = active;
  if (fixture === null) return;
  active = null;
  const failures: Error[] = [];
  if (fixture.terminal !== null) {
    await closeOutcome(() => fixture.terminal?.close() ?? Promise.resolve(), failures);
  }
  await closeOutcome(() => fixture.project.close(), failures);
  await closeOutcome(() => fixture.workbench.close(), failures);
  fixture.baseElement.remove();
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Sealed browser-unit Workbench fixture close failed');
  }
}

export function sameExit(left: ProcessExit, right: ProcessExit): boolean {
  return left.code === right.code && left.signal === right.signal;
}
