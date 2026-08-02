import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { type Response, expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness } from './fixtures.ts';

interface RecordedResponse {
  readonly path: string;
  readonly status: number;
  readonly contentType: string | null;
  readonly bodyBytes: number;
  readonly bodySha256: string;
}

interface Measurement {
  readonly schema: 1;
  readonly revision: string;
  readonly scenario: {
    readonly id: 'cold-sass-embedded-1.100.0-install';
    readonly persistence: 'ephemeral';
    readonly command: 'npm install';
    readonly instrumentation: 'BrowserContext.response+wall-clock';
  };
  readonly environment: {
    readonly browserName: 'chromium';
    readonly browserVersion: string;
    readonly nodeVersion: string;
    readonly platform: string;
    readonly architecture: string;
  };
  readonly responses: readonly RecordedResponse[];
  readonly totalBodyBytes: number;
  readonly installWallTimeMs: number;
  readonly install: Readonly<{
    exit: number;
    outcome: 'success' | "NotImplementedError('npm-client.bin-collision-reify')";
  }>;
}

interface SubstitutionArtifact {
  readonly schema: 1;
  readonly before: Measurement;
  readonly after: Measurement;
  readonly delta: {
    readonly bodyBytes: number;
    readonly installWallTimeMs: number;
  };
}

function registryPath(value: string): string | null {
  const url = new URL(value);
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    path = url.pathname;
  }
  const registryIndex = path.toLowerCase().indexOf('/npm-registry');
  return registryIndex === -1 ? null : path.slice(registryIndex);
}

function isTarballFor(path: string, packageName: string): boolean {
  const normalized = path.replaceAll('%2F', '/').replaceAll('%2f', '/');
  return (
    normalized.includes(`/${packageName}/-/`) ||
    normalized.includes(`/${packageName.replace('/', '%2f')}/-/`)
  );
}

function validateMeasurement(measurement: Measurement): void {
  expect(measurement.schema).toBe(1);
  expect(measurement.revision).toMatch(/^[0-9a-f]{40}$/u);
  expect(measurement.totalBodyBytes).toBe(
    measurement.responses.reduce((sum, response) => sum + response.bodyBytes, 0),
  );
  expect(measurement.installWallTimeMs).toBeGreaterThan(0);
  expect(Number.isInteger(measurement.install.exit)).toBe(true);
  for (const response of measurement.responses) {
    expect(response.status).toBe(200);
    expect(response.bodySha256).toMatch(/^[0-9a-f]{64}$/u);
  }
}

function validateCommittedEvidence(): void {
  const artifact = JSON.parse(
    readFileSync(new URL('../../perf/sass-shadow-substitution.json', import.meta.url), 'utf8'),
  ) as SubstitutionArtifact;
  expect(artifact.schema).toBe(1);
  expect(artifact.before.scenario).toEqual(artifact.after.scenario);
  expect(artifact.before.environment).toEqual(artifact.after.environment);
  validateMeasurement(artifact.before);
  validateMeasurement(artifact.after);
  expect(artifact.before.install).toEqual({
    exit: 1,
    outcome: "NotImplementedError('npm-client.bin-collision-reify')",
  });
  expect(artifact.after.install).toEqual({ exit: 0, outcome: 'success' });
  expect(artifact.delta).toEqual({
    bodyBytes: artifact.after.totalBodyBytes - artifact.before.totalBodyBytes,
    installWallTimeMs: artifact.after.installWallTimeMs - artifact.before.installWallTimeMs,
  });
  expect(
    artifact.before.responses.some(({ path }) => isTarballFor(path, 'sass-embedded')),
    'unshadowed baseline must carry the requested native-backed package',
  ).toBe(true);
  expect(
    artifact.after.responses.some(({ path }) => isTarballFor(path, 'sass')),
    'shadowed install must carry the exact pure-JS twin',
  ).toBe(true);
  expect(
    artifact.after.responses.filter(
      ({ path }) =>
        path.includes('/sass-embedded') ||
        path.includes('sass-embedded-') ||
        path.includes('@parcel/watcher') ||
        path.includes('@parcel%2Fwatcher'),
    ),
    'shadowed install must not acquire the native carrier or omitted watcher',
  ).toEqual([]);
}

test('records matched cold Sass twin install bytes and wall time without a threshold', async ({
  browser,
  context,
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const unshadowedBaseline = process.env.RIFTY_SASS_NETWORK_ALLOW_UNSHADOWED_BASELINE === '1';
  if (!unshadowedBaseline) {
    validateCommittedEvidence();
  }
  const responses: RecordedResponse[] = [];
  const failures: unknown[] = [];
  const pending = new Set<Promise<void>>();
  const onResponse = (response: Response): void => {
    const path = registryPath(response.url());
    if (path === null) return;
    const capture = response
      .body()
      .then((body) => {
        responses.push({
          path,
          status: response.status(),
          contentType: response.headers()['content-type'] ?? null,
          bodyBytes: body.byteLength,
          bodySha256: createHash('sha256').update(body).digest('hex'),
        });
      })
      .catch((error: unknown) => {
        failures.push(error);
      })
      .finally(() => pending.delete(capture));
    pending.add(capture);
  };
  context.on('response', onResponse);
  let ownerOpen = false;

  try {
    await gotoHarness(page);
    await bootOwner(page, {
      workspaceId: 'bu-sass-network-measurement',
      persistence: 'ephemeral',
      plan: {
        kind: 'node-cli',
        id: 'scratch',
        starterId: 'sass-network-measurement',
        templateId: 'browser-unit:sass-network-measurement-v2',
        files: {
          '/package.json': '{"name":"sass-network-measurement","private":true,"type":"module"}\n',
          '/noop.mjs': '',
        },
        dependencies: { 'sass-embedded': '1.100.0' },
        firstMaterialization: { kind: 'install' },
        entryPath: '/noop.mjs',
      },
    });
    ownerOpen = true;
    const startedAt = performance.now();
    const install = await execLine(page, 'npm install');
    const installWallTimeMs = Math.round(performance.now() - startedAt);
    const installOutcome =
      install.exit === 0
        ? ('success' as const)
        : install.exit === 1 &&
            install.out.includes('Not implemented: npm-client.bin-collision-reify')
          ? ("NotImplementedError('npm-client.bin-collision-reify')" as const)
          : null;
    if (installOutcome === null) {
      throw new Error(`unexpected Sass measurement install outcome:\n${install.out}`);
    }

    while (pending.size > 0) await Promise.all([...pending]);
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Sass response body capture failed');
    }
    responses.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const measurement: Measurement = {
      schema: 1,
      revision: process.env.RIFTY_SASS_NETWORK_REVISION ?? 'working-tree',
      scenario: {
        id: 'cold-sass-embedded-1.100.0-install',
        persistence: 'ephemeral',
        command: 'npm install',
        instrumentation: 'BrowserContext.response+wall-clock',
      },
      environment: {
        browserName: 'chromium',
        browserVersion: browser.version(),
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
      },
      responses,
      totalBodyBytes: responses.reduce((sum, response) => sum + response.bodyBytes, 0),
      installWallTimeMs,
      install: { exit: install.exit, outcome: installOutcome },
    };
    validateMeasurement(measurement);
    await testInfo.attach('sass-network-measurement.json', {
      body: Buffer.from(`${JSON.stringify(measurement, null, 2)}\n`),
      contentType: 'application/json',
    });
    const output = process.env.RIFTY_SASS_NETWORK_OUTPUT;
    if (output !== undefined) {
      const absolute = resolve(output);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, `${JSON.stringify(measurement, null, 2)}\n`);
    }

    if (unshadowedBaseline) {
      expect(measurement.install, install.out).toEqual({
        exit: 1,
        outcome: "NotImplementedError('npm-client.bin-collision-reify')",
      });
      expect(responses.some(({ path }) => isTarballFor(path, 'sass-embedded'))).toBe(true);
    } else {
      expect(measurement.install, install.out).toEqual({ exit: 0, outcome: 'success' });
      expect(responses.some(({ path }) => isTarballFor(path, 'sass'))).toBe(true);
      expect(
        responses.filter(
          ({ path }) =>
            path.includes('/sass-embedded') ||
            path.includes('sass-embedded-') ||
            path.includes('@parcel/watcher') ||
            path.includes('@parcel%2Fwatcher'),
        ),
        'shadowed cold install must not acquire the native carrier or omitted watcher',
      ).toEqual([]);
    }
  } finally {
    context.off('response', onResponse);
    if (ownerOpen) await closeOwner(page);
  }
});
