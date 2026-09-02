import { describe, expect, it } from 'vitest';
import type { NpmDevServerPlaygroundPlan, PlaygroundProjectPlan } from '../playground.ts';
import {
  definePlaygroundProject,
  inspectPlaygroundProjectDefinition,
  inspectPlaygroundProjectDefinitionWire,
  ownPlaygroundProjectPlan,
  playgroundProjectDefinitionWire,
} from './playground-project-definition.ts';

const URL_CONTEXT = Object.freeze({
  apiBaseUrl: 'https://playground.test/app/',
  clientUrl: 'https://playground.test/app/index.html',
});

function plan(dev = 'webpack serve'): NpmDevServerPlaygroundPlan {
  return {
    kind: 'npm-dev-server',
    id: 'scratch',
    starterId: 'webpack-dev-server',
    templateId: 'webpack-dev-server',
    files: {
      '/package.json': `${JSON.stringify({ scripts: { dev } })}\n`,
      '/webpack.config.js': 'module.exports = {};\n',
    },
    firstMaterialization: { kind: 'install' },
  };
}

describe('npm dev-server Playground definition Contract+RED', () => {
  it('owns exactly the common public plan fields with one zero-field discriminant', () => {
    const owned = ownPlaygroundProjectPlan(plan(), URL_CONTEXT);

    expect(owned.kind).toBe('npm-dev-server');
    expect(Reflect.ownKeys(owned).sort()).toEqual([
      'files',
      'firstMaterialization',
      'id',
      'kind',
      'starterId',
      'templateId',
    ]);
    expect(Object.isFrozen(owned)).toBe(true);
    expect(Object.isFrozen(owned.files)).toBe(true);
    expect(Object.isFrozen(owned.firstMaterialization)).toBe(true);
  });

  it.each([
    ['command', 'webpack serve'],
    ['entryPath', '/package.json'],
    ['port', 5184],
    ['readinessRegex', 'compiled successfully'],
    ['webpack', true],
  ])('rejects tool/runtime-specific extra key %s', (key, value) => {
    const forged = { ...plan(), [key]: value } as unknown as PlaygroundProjectPlan;

    expect(() => ownPlaygroundProjectPlan(forged, URL_CONTEXT)).toThrow(/unknown key|exactly/i);
  });

  it('round-trips exact plan and core bytes while recomputing owner identity', () => {
    const definition = definePlaygroundProject(plan(), URL_CONTEXT);
    const pageInspected = inspectPlaygroundProjectDefinition(definition, URL_CONTEXT);
    const wire = playgroundProjectDefinitionWire(definition);
    const ownerInspected = inspectPlaygroundProjectDefinitionWire(
      structuredClone(wire),
      URL_CONTEXT,
    );

    expect(ownerInspected).toEqual(pageInspected);
    expect(ownerInspected.identity).toBe(pageInspected.identity);
    expect('entryPath' in ownerInspected).toBe(false);
    expect('port' in ownerInspected).toBe(false);
    expect(Object.isFrozen(ownerInspected)).toBe(true);
  });

  it('rejects forged core identity and a plan whose manifest diverges from core bytes', () => {
    const definition = definePlaygroundProject(plan(), URL_CONTEXT);
    const wire = structuredClone(playgroundProjectDefinitionWire(definition));
    const forgedIdentity = structuredClone(wire) as unknown as {
      definition: Record<string, unknown>;
      plan: Record<string, unknown>;
    };
    forgedIdentity.definition.identity = 'forged';
    const divergentPlan = structuredClone(wire) as unknown as {
      definition: Record<string, unknown>;
      plan: { files: Record<string, string | Uint8Array> };
    };
    divergentPlan.plan.files['/package.json'] = '{"scripts":{"dev":"vite"}}\n';

    expect(() => inspectPlaygroundProjectDefinitionWire(forgedIdentity, URL_CONTEXT)).toThrow(
      /identity/i,
    );
    expect(() => inspectPlaygroundProjectDefinitionWire(divergentPlan, URL_CONTEXT)).toThrow(
      /plan|bytes|match/i,
    );
  });
});
