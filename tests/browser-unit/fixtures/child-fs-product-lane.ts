import {
  childFsScenario,
  childFsScenarioIdentity,
} from '../../../tools/perf/child-fs/scenario.mjs';
import { validateChildFsRawSample } from '../../../tools/perf/src/child-fs-artifact.mjs';

interface ProcessExit {
  readonly code: number | null;
  readonly signal: string | null;
}

interface CommandOutcome {
  readonly exitCode: number;
  readonly exit: ProcessExit;
  readonly closeExit: ProcessExit;
  readonly closeShared: boolean;
  readonly settlements: number;
  readonly out: string;
}

interface ProjectEntry {
  readonly path: string;
  readonly kind?: string;
}

export interface ChildFsProductLaneHost {
  readonly coi: boolean;
  readonly open: (plan: unknown) => Promise<void>;
  readonly writeText: (path: string, contents: string) => Promise<void>;
  readonly execute: (line: string) => Promise<CommandOutcome>;
  readonly readdir: (path: string) => Promise<readonly ProjectEntry[]>;
  readonly readText: (path: string) => Promise<string>;
  readonly close: () => Promise<void>;
}

function sameExit(left: ProcessExit, right: ProcessExit): boolean {
  return left.code === right.code && left.signal === right.signal;
}

function requireSuccessfulCommand(outcome: CommandOutcome, label: string): CommandOutcome {
  if (
    outcome.exitCode !== 0 ||
    outcome.exit.code !== 0 ||
    outcome.exit.signal !== null ||
    !sameExit(outcome.exit, outcome.closeExit) ||
    !outcome.closeShared ||
    outcome.settlements !== 1
  ) {
    throw new Error(`${label} did not settle once with one shared successful close`);
  }
  return outcome;
}

function installedVersion(manifest: string, dependency: string): string {
  let value: unknown;
  try {
    value = JSON.parse(manifest);
  } catch (error) {
    throw new Error(`installed ${dependency} manifest is not valid JSON`, { cause: error });
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`installed ${dependency} manifest must be an object`);
  }
  const version = Reflect.get(value, 'version');
  if (typeof version !== 'string') {
    throw new TypeError(`installed ${dependency} manifest has no string version`);
  }
  return version;
}

function markerSource(seed: string, marker: string, ordinal: number): string {
  const first = seed.replace('bench-seed', marker);
  const result = first.replace('bench-seed', `run-${ordinal}`);
  if (result === first || result.split(marker).length !== 2) {
    throw new Error('canonical Panel seed does not carry the expected marker slots');
  }
  return result;
}

async function runOpenedProductLane(ordinal: number, host: ChildFsProductLaneHost) {
  const scenario = childFsScenario();
  const marker = `product-coi-${ordinal}`;
  const panelSeed = scenario.files['/src/Panel.jsx'];
  if (panelSeed === undefined) throw new TypeError('canonical Panel seed is missing');

  requireSuccessfulCommand(await host.execute('npm install'), 'npm install');
  for (const [dependency, expectedVersion] of Object.entries(scenario.dependencies)) {
    const path = `/node_modules/${dependency}/package.json`;
    const actualVersion = installedVersion(await host.readText(path), dependency);
    if (actualVersion !== expectedVersion) {
      throw new Error(
        `installed ${dependency} version ${JSON.stringify(actualVersion)} does not match ${JSON.stringify(expectedVersion)}`,
      );
    }
  }

  await host.writeText('/src/Panel.jsx', markerSource(panelSeed, marker, ordinal));
  const vite = requireSuccessfulCommand(await host.execute('vite build'), 'vite build');
  const entries = await host.readdir('/dist/assets');
  const emittedPaths = entries
    .filter(({ path }) => path.startsWith('/dist/assets/') && path.endsWith('.js'))
    .map(({ path }) => path)
    .toSorted();
  if (emittedPaths.length === 0) throw new Error('vite build emitted no JavaScript assets');
  const emittedJavaScript = (
    await Promise.all(emittedPaths.map((path) => host.readText(path)))
  ).join('\n');
  const express = requireSuccessfulCommand(
    await host.execute(`node express-anchor.cjs ${marker}`),
    'express cold start',
  );
  const sample = {
    lane: 'product-coi' as const,
    topology: 'owner-sync-rpc-kernel-child' as const,
    ordinal,
    ownerLoad: 'idle' as const,
    vite: {
      exitCode: vite.exitCode,
      rawOutput: vite.out,
      emittedJavaScript,
      marker,
    },
    express: {
      exitCode: express.exitCode,
      rawOutput: express.out,
      marker,
    },
  };
  const parsed = validateChildFsRawSample(sample);
  if (parsed.vite.transformedModules !== 2180) {
    throw new Error(
      `product child fs scenario transformed ${parsed.vite.transformedModules} modules, expected 2180`,
    );
  }
  return {
    identity: childFsScenarioIdentity(),
    lifecycle: { vite, express },
    sample,
  };
}

export async function runChildFsProductLane(ordinal: number, host: ChildFsProductLaneHost) {
  if (!Number.isInteger(ordinal) || ordinal <= 0) {
    throw new TypeError('child fs product ordinal must be a positive integer');
  }
  if (!host.coi) throw new Error('child fs product lane requires cross-origin isolation');

  const scenario = childFsScenario();
  let opened = false;
  let failed = false;
  let primaryError: unknown;
  let closeFailed = false;
  let closeError: unknown;
  let result: Awaited<ReturnType<typeof runOpenedProductLane>> | undefined;
  try {
    await host.open({
      kind: 'node-cli',
      id: 'scratch',
      starterId: 'child-fs-product-lane',
      templateId: 'browser-unit:child-fs-product-lane-v1',
      files: scenario.files,
      dependencies: scenario.dependencies,
      firstMaterialization: { kind: 'install' },
      entryPath: '/express-anchor.cjs',
    });
    opened = true;
    result = await runOpenedProductLane(ordinal, host);
  } catch (error) {
    failed = true;
    primaryError = error;
  } finally {
    if (opened) {
      try {
        await host.close();
      } catch (error) {
        closeFailed = true;
        closeError = error;
      }
    }
  }
  if (failed && closeFailed) {
    throw new AggregateError(
      [primaryError, closeError],
      'child fs product lane and host close both failed',
    );
  }
  if (failed) throw primaryError;
  if (closeFailed) throw closeError;
  if (result === undefined) throw new Error('child fs product lane produced no result');
  return result;
}
