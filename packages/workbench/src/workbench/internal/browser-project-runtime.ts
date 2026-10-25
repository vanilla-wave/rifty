import {
  createNodeCliProjectRuntime,
  createNodeServerProjectRuntime,
  createNpmDevServerProjectRuntime,
} from '../node-project-runtime.ts';
import type { PreviewReadiness } from '../preview-readiness.ts';
import type { InspectedProjectDefinition } from '../project-definition.ts';
import type { ProjectAcquisitionPlan } from '../project-materialization.ts';
import type { ProjectRuntime } from '../project-session.ts';
import type { ProjectTerminal } from '../project-terminal.ts';
import { createViteProjectRuntime } from '../vite-project-runtime.ts';
import type { PlaygroundProjectRuntimeDecision } from './playground-owner-protocol.ts';

export interface BrowserProjectRuntimeDependencies {
  readonly definition: InspectedProjectDefinition;
  readonly terminal: ProjectTerminal;
  readonly ownerToken: string;
  readonly createPreviewReadiness: () => PreviewReadiness;
  readonly acquisition?: ProjectAcquisitionPlan;
  readonly decision?: PlaygroundProjectRuntimeDecision;
}

/** Owns finite project-definition dispatch and owner-decision consistency. */
export function createBrowserProjectRuntime(
  dependencies: BrowserProjectRuntimeDependencies,
): ProjectRuntime<unknown> {
  const { acquisition, decision, definition, terminal } = dependencies;
  if (decision !== undefined && decision.kind !== definition.kind) {
    throw new TypeError('Owner Playground runtime does not match the project definition');
  }
  if (definition.kind === 'node-cli') {
    return createNodeCliProjectRuntime({
      terminal,
      entryPath: definition.entryPath,
      args: definition.args,
      acquisition,
    });
  }
  const previewDependencies = {
    terminal,
    ownerToken: dependencies.ownerToken,
    createPreviewReadiness: dependencies.createPreviewReadiness,
    acquisition,
  };
  if (definition.kind === 'npm-dev-server') {
    return createNpmDevServerProjectRuntime(previewDependencies);
  }
  if (definition.kind === 'node-server') {
    return createNodeServerProjectRuntime({
      ...previewDependencies,
      entryPath: definition.entryPath,
      port: definition.port,
    });
  }
  return createViteProjectRuntime({
    ...previewDependencies,
    ...(decision?.kind === 'vite' ? { port: decision.port } : {}),
  });
}
