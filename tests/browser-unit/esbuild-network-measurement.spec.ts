import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { type Response, expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness } from './fixtures.ts';

type ResponseKind = 'host-wasm' | 'legacy-alias' | 'registry';

interface RecordedResponse {
  readonly kind: ResponseKind;
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
    readonly id: 'cold-vite-7.3.6-install-build';
    readonly persistence: 'ephemeral';
    readonly commands: readonly ['npm install', 'vite build'];
    readonly instrumentation: 'BrowserContext.response';
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
}

interface CutoverArtifact {
  readonly schema: 1;
  readonly before: Measurement;
  readonly after: Measurement;
  readonly delta: {
    readonly beforeBodyBytes: number;
    readonly afterBodyBytes: number;
    readonly netRemovedBodyBytes: number;
  };
}

function canonicalResponse(value: string): Readonly<{ kind: ResponseKind; path: string }> | null {
  const url = new URL(value);
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    path = url.pathname;
  }
  const lower = path.toLowerCase();
  const registryIndex = lower.indexOf('/npm-registry');
  if (registryIndex !== -1) {
    const registryPath = path.slice(registryIndex);
    return registryPath.toLowerCase().includes('esbuild')
      ? { kind: 'registry', path: registryPath }
      : null;
  }
  const nodeModulesIndex = path.lastIndexOf('/node_modules/');
  const stablePath = nodeModulesIndex === -1 ? path : path.slice(nodeModulesIndex);
  if (lower.includes('@esbuild/wasi-preview1')) {
    return { kind: 'legacy-alias', path: stablePath };
  }
  return lower.endsWith('/esbuild.wasm') ? { kind: 'host-wasm', path: stablePath } : null;
}

function validateCommittedEvidence(): void {
  const artifact = JSON.parse(
    readFileSync(new URL('../../perf/esbuild-network-cutover.json', import.meta.url), 'utf8'),
  ) as CutoverArtifact;
  expect(artifact.schema).toBe(1);
  expect(artifact.before.revision).toBe('263c00b3c328ba7c7a77a023ba3486decc37a382');
  expect(artifact.before.scenario).toEqual(artifact.after.scenario);
  expect(artifact.before.environment).toEqual(artifact.after.environment);
  for (const measurement of [artifact.before, artifact.after]) {
    expect(measurement.totalBodyBytes).toBe(
      measurement.responses.reduce((sum, response) => sum + response.bodyBytes, 0),
    );
    for (const response of measurement.responses) {
      expect(response.status).toBe(200);
      expect(response.bodySha256).toMatch(/^[0-9a-f]{64}$/u);
    }
  }
  expect(artifact.delta).toEqual({
    beforeBodyBytes: artifact.before.totalBodyBytes,
    afterBodyBytes: artifact.after.totalBodyBytes,
    netRemovedBodyBytes: artifact.before.totalBodyBytes - artifact.after.totalBodyBytes,
  });
  expect(artifact.delta).toEqual({
    beforeBodyBytes: 19_022_728,
    afterBodyBytes: 4_888_651,
    netRemovedBodyBytes: 14_134_077,
  });
  expect(
    artifact.after.responses.some(
      ({ kind, path }) =>
        kind === 'registry' && path.includes('/esbuild-wasm/-/esbuild-wasm-0.28.0.tgz'),
    ),
  ).toBe(true);
  expect(
    artifact.after.responses.filter(({ kind }) => kind === 'host-wasm' || kind === 'legacy-alias'),
  ).toEqual([]);
}

test('records matched cold Vite 7 install/build esbuild response bytes', async ({
  browser,
  context,
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  validateCommittedEvidence();
  const responses: RecordedResponse[] = [];
  const failures: unknown[] = [];
  const pending = new Set<Promise<void>>();
  const onResponse = (response: Response): void => {
    const canonical = canonicalResponse(response.url());
    if (canonical === null) return;
    const capture = response
      .body()
      .then((body) => {
        responses.push({
          ...canonical,
          status: response.status(),
          contentType: response.headers()['content-type'] ?? null,
          bodyBytes: body.byteLength,
          bodySha256: createHash('sha256').update(body).digest('hex'),
        });
      })
      .catch((error: unknown) => failures.push(error))
      .finally(() => pending.delete(capture));
    pending.add(capture);
  };
  context.on('response', onResponse);
  let ownerOpen = false;

  try {
    await gotoHarness(page);
    await bootOwner(page, {
      workspaceId: 'bu-esbuild-network-measurement',
      persistence: 'ephemeral',
      plan: {
        kind: 'vite',
        id: 'scratch',
        starterId: 'esbuild-network-measurement',
        templateId: 'browser-unit:esbuild-network-measurement-v1',
        files: {
          '/package.json':
            '{"name":"esbuild-network-measurement","private":true,"type":"module"}\n',
          '/index.html': '<div id="app"></div><script type="module" src="/src/main.js"></script>\n',
          '/src/main.js': "document.getElementById('app').textContent = 'measurement';\n",
          '/vite.config.js': 'export default { optimizeDeps: { noDiscovery: true } };\n',
        },
        dependencies: { vite: '7.3.6' },
        firstMaterialization: { kind: 'install' },
        port: 5174,
      },
    });
    ownerOpen = true;
    for (const command of ['npm install', 'vite --version', 'vite build']) {
      const result = await execLine(page, command);
      expect(result.exit, result.out).toBe(0);
      if (command === 'vite --version') expect(result.out).toContain('vite/7.3.6');
    }

    while (pending.size > 0) await Promise.all([...pending]);
    if (failures.length > 0) {
      throw new AggregateError(failures, 'esbuild response body capture failed');
    }
    responses.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const measurement: Measurement = {
      schema: 1,
      revision: process.env.RIFTY_ESBUILD_NETWORK_REVISION ?? 'working-tree',
      scenario: {
        id: 'cold-vite-7.3.6-install-build',
        persistence: 'ephemeral',
        commands: ['npm install', 'vite build'],
        instrumentation: 'BrowserContext.response',
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
    };
    const json = `${JSON.stringify(measurement, null, 2)}\n`;
    await testInfo.attach('esbuild-network-measurement.json', {
      body: Buffer.from(json),
      contentType: 'application/json',
    });
    const output = process.env.RIFTY_ESBUILD_NETWORK_OUTPUT;
    if (output !== undefined) {
      const absolute = resolve(output);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, json);
    }

    if (process.env.RIFTY_ESBUILD_NETWORK_ALLOW_LEGACY_BASELINE !== '1') {
      expect(responses.some(({ kind }) => kind === 'host-wasm')).toBe(false);
      expect(
        responses.some(
          ({ kind, path }) =>
            kind === 'registry' && path.includes('/esbuild-wasm/-/esbuild-wasm-0.28.0.tgz'),
        ),
      ).toBe(true);
    }
  } finally {
    context.off('response', onResponse);
    if (ownerOpen) await closeOwner(page);
  }
});
