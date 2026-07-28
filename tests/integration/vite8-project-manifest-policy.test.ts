import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { serializePackageJson } from '@riftydev/npm-client';
import { describe, expect, it } from 'vitest';
import { toPlaygroundProjectPlan } from '../../apps/playground/src/adapters/playground-project-plan.ts';
import { starterFromPreset } from '../../apps/playground/src/glue/starter.ts';
import { PRESETS } from '../../apps/playground/src/presets.ts';
import { allProjectSpecs } from '../../apps/playground/src/templates/registry.ts';
import {
  definePlaygroundProject,
  inspectPlaygroundProjectDefinition,
} from '../../packages/workbench/src/workbench/internal/playground-project-definition.ts';
import { workbenchFirstMaterializationPackageConfig } from '../../packages/workbench/src/workers/workbench-package-config.ts';

const PUBLIC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../apps/playground/public');
const URL_CONTEXT = Object.freeze({
  apiBaseUrl: 'https://playground.test/npm-registry/',
  clientUrl: 'https://playground.test/',
});
const PROVEN_VITE8_WASI_RUNTIME_OVERRIDE = {
  '@napi-rs/wasm-runtime': 'npm:@napi-rs/wasm-runtime@1.1.6',
} as const;
const decoder = new TextDecoder();

function artifactPath(url: string): string {
  return join(PUBLIC_ROOT, ...url.replace(/^\/+/, '').split('/'));
}

function snapshotIdentity(url: string): string {
  const serialized = gunzipSync(readFileSync(artifactPath(url)));
  return `sha256:${createHash('sha256').update(serialized).digest('hex')}`;
}

describe('Vite snapshot final-manifest policy', () => {
  // Fault class: sibling-drift. One real Workbench definition must feed the
  // Playground identity, owner install plan, bake output, and snapshot descriptor.
  it.each(
    allProjectSpecs()
      .filter((spec) => spec.runtime === 'vite' && spec.bakedNodeModulesUrl !== undefined)
      .map((spec) => [spec.id, spec] as const),
  )('keeps %s Workbench, Playground, owner, and bake bytes identical', (_id, spec) => {
    if (spec.bakedNodeModulesUrl === undefined) throw new Error('filtered snapshot URL missing');
    const preset = PRESETS.find(
      (candidate) => candidate.setup === 'instant' && (candidate.templateId ?? 'vite') === spec.id,
    );
    if (preset === undefined) throw new Error(`${spec.id}: instant preset missing`);
    const plan = toPlaygroundProjectPlan({
      projectId: `snapshot-contract-${spec.id}`,
      starter: starterFromPreset(preset),
      setup: preset.setup,
    });
    if (plan.kind !== 'vite' || plan.firstMaterialization.kind !== 'snapshot') {
      throw new Error(`${spec.id}: Vite snapshot plan missing`);
    }

    const definition = definePlaygroundProject(plan, URL_CONTEXT);
    const inspected = inspectPlaygroundProjectDefinition(definition, URL_CONTEXT);
    const packageJsonBytes = inspected.files['/package.json'];
    if (packageJsonBytes === undefined) throw new Error(`${spec.id}: package.json missing`);
    const workbenchPackageJson = decoder.decode(packageJsonBytes);
    const ownerConfig = workbenchFirstMaterializationPackageConfig(
      inspected,
      `/owner/projects/${spec.id}`,
      { packageJsonBytes },
    );
    const snapshot = JSON.parse(
      gunzipSync(readFileSync(artifactPath(spec.bakedNodeModulesUrl))).toString('utf8'),
    ) as { readonly packageJsonText?: unknown };

    expect(ownerConfig.cfg.packageJson).toBe(workbenchPackageJson);
    expect(snapshot.packageJsonText).toBe(workbenchPackageJson);
    expect(plan.firstMaterialization.snapshot.snapshotId).toBe(
      snapshotIdentity(spec.bakedNodeModulesUrl),
    );

    if (spec.id !== 'vite8') return;
    expect(JSON.parse(workbenchPackageJson)).toMatchObject({
      dependencies: { vite: '8.0.16' },
      overrides: PROVEN_VITE8_WASI_RUNTIME_OVERRIDE,
    });

    const rawPackageJson = plan.files['/package.json'];
    if (rawPackageJson === undefined) throw new Error('Vite 8 plan package.json missing');
    const explicitManifest = JSON.parse(
      typeof rawPackageJson === 'string' ? rawPackageJson : decoder.decode(rawPackageJson),
    ) as Record<string, unknown>;
    explicitManifest.overrides = PROVEN_VITE8_WASI_RUNTIME_OVERRIDE;
    const explicitDefinition = definePlaygroundProject(
      {
        ...plan,
        files: {
          ...plan.files,
          '/package.json': serializePackageJson(explicitManifest),
        },
      },
      URL_CONTEXT,
    );
    const explicit = inspectPlaygroundProjectDefinition(explicitDefinition, URL_CONTEXT);
    expect(explicit.identity).toBe(inspected.identity);
    expect(decoder.decode(explicit.files['/package.json'] as Uint8Array)).toBe(
      workbenchPackageJson,
    );
  });
});
