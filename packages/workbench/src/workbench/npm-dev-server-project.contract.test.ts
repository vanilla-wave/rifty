import { describe, expect, expectTypeOf, it } from 'vitest';
import type { PreviewHandle } from './preview-readiness.ts';
import {
  type ProjectDefinition,
  defineNpmDevServerProject,
  inspectProjectDefinition,
  inspectProjectDefinitionWire,
  projectDefinitionWire,
} from './project-definition.ts';

type PublicWorkbenchModule = typeof import('./public.ts');

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function files(dev = 'webpack serve'): Readonly<Record<string, string>> {
  return {
    '/package.json': `${JSON.stringify({
      name: 'npm-dev-server-contract',
      scripts: { dev, build: 'webpack' },
      devDependencies: { webpack: '5.101.0', 'webpack-dev-server': '5.2.2' },
    })}\n`,
    '/webpack.config.js': 'module.exports = {};\n',
  };
}

describe('package-private npm dev-server project definition Contract+RED', () => {
  it('mints a preview-ready zero-field definition without widening the public root', () => {
    const definition = defineNpmDevServerProject({ id: 'webpack', files: files() });
    const inspected = inspectProjectDefinition(definition);

    expectTypeOf(definition).toEqualTypeOf<ProjectDefinition<PreviewHandle>>();
    expectTypeOf<
      Extract<keyof PublicWorkbenchModule, 'defineNpmDevServerProject'>
    >().toEqualTypeOf<never>();
    expect(inspected.kind).toBe('npm-dev-server');
    expect(Reflect.ownKeys(inspected).sort()).toEqual([
      'files',
      'id',
      'identity',
      'kind',
      'storageSegment',
    ]);
    expect(decoder.decode(inspected.files['/package.json'])).toBe(files()['/package.json']);
  });

  it.each([
    ['missing manifest', {}],
    ['missing scripts', { '/package.json': '{"name":"missing-scripts"}\n' }],
    ['non-object scripts', { '/package.json': '{"scripts":[]}\n' }],
    ['missing dev script', { '/package.json': '{"scripts":{"build":"webpack"}}\n' }],
    ['non-string dev script', { '/package.json': '{"scripts":{"dev":7}}\n' }],
    ['empty dev script', { '/package.json': '{"scripts":{"dev":""}}\n' }],
  ])('rejects %s before minting owner authority', (_label, invalidFiles) => {
    expect(() =>
      defineNpmDevServerProject({ id: 'invalid-npm-dev-server', files: invalidFiles }),
    ).toThrow(/package\.json|scripts\.dev/i);
  });

  it('round-trips only kind, id, identity, and exact files through owner ingress', () => {
    const inspected = inspectProjectDefinition(
      defineNpmDevServerProject({ id: 'wire-npm-dev-server', files: files() }),
    );
    const wire = projectDefinitionWire(inspected);
    const ownerInspected = inspectProjectDefinitionWire(structuredClone(wire));

    expect(Reflect.ownKeys(wire).sort()).toEqual(['files', 'id', 'identity', 'kind']);
    expect(ownerInspected).toEqual(inspected);
    expect(ownerInspected.files['/package.json']).not.toBe(inspected.files['/package.json']);
    expect(Object.isFrozen(ownerInspected)).toBe(true);
    expect(Object.isFrozen(ownerInspected.files)).toBe(true);
  });

  it('rejects forged identity, changed manifest bytes, and fake runtime coordinates', () => {
    const inspected = inspectProjectDefinition(
      defineNpmDevServerProject({ id: 'forged-npm-dev-server', files: files() }),
    );
    const exact = structuredClone(projectDefinitionWire(inspected));
    const changedBytes = structuredClone(exact);
    (changedBytes.files as Record<string, Uint8Array>)['/package.json'] = encoder.encode(
      decoder.decode(changedBytes.files['/package.json']).replace('webpack serve', 'vite'),
    );

    expect(() => inspectProjectDefinitionWire({ ...exact, identity: 'forged' })).toThrow(
      /identity/i,
    );
    expect(() => inspectProjectDefinitionWire(changedBytes)).toThrow(/identity/i);
    expect(() => inspectProjectDefinitionWire({ ...exact, entryPath: '/package.json' })).toThrow(
      TypeError,
    );
    expect(() => inspectProjectDefinitionWire({ ...exact, port: 5184 })).toThrow(TypeError);
  });
});
