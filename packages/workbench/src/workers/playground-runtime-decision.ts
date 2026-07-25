import type { PlaygroundProjectRuntimeDecision } from '../workbench/internal/playground-owner-protocol.ts';
import type { InspectedPlaygroundProjectDefinition } from '../workbench/internal/playground-project-definition.ts';

/** Concrete Playground edge kept outside generic owner orchestration (ADR-0308). */
export function playgroundRuntimeDecision(
  definition: Pick<InspectedPlaygroundProjectDefinition, 'kind' | 'port'>,
): PlaygroundProjectRuntimeDecision {
  if (definition.kind === 'vite') {
    if (definition.port === undefined) {
      throw new TypeError('Playground Vite definition is missing its owner port');
    }
    return Object.freeze({ kind: 'vite', port: definition.port });
  }
  return Object.freeze({ kind: definition.kind });
}
