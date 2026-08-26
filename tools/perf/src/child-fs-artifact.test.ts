import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const VITE_GOLDEN = JSON.parse(
  readFileSync(new URL('../child-fs/vite-7.3.6-node-golden.json', import.meta.url), 'utf8'),
) as {
  readonly schemaVersion: number;
  readonly scenarioId: string;
  readonly command: string;
  readonly exitCode: number;
  readonly viteVersion: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly rawOutput: string;
};

const DEPENDENCIES = Object.freeze({
  '@gravity-ui/icons': '2.22.0',
  '@gravity-ui/uikit': '7.48.1',
  'date-fns': '4.4.0',
  express: '4.21.2',
  react: '19.2.8',
  'react-dom': '19.2.8',
  vite: '7.3.6',
});

const PACKAGE_JSON = `${JSON.stringify(
  {
    name: 'rifty-child-fs-benchmark',
    private: true,
    version: '0.0.0',
    type: 'module',
    dependencies: DEPENDENCIES,
  },
  null,
  2,
)}\n`;

const FILES = Object.freeze({
  '/package.json': PACKAGE_JSON,
  '/index.html':
    '<!doctype html><div id="root"></div><script type="module" src="/src/main.jsx"></script>\n',
  '/vite.config.js':
    "export default { esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true, include: [] }, build: { minify: false, sourcemap: false } };\n",
  '/src/main.jsx':
    "import { createRoot } from 'react-dom/client'; import { ThemeProvider } from '@gravity-ui/uikit'; import '@gravity-ui/uikit/styles/styles.css'; import { App } from './App.jsx'; createRoot(document.getElementById('root')).render(<ThemeProvider theme=\"light\"><App /></ThemeProvider>);\n",
  '/src/App.jsx':
    "import { Button, Card, Text } from '@gravity-ui/uikit'; import { Gear } from '@gravity-ui/icons'; import { format } from 'date-fns'; import { Panel } from './Panel.jsx'; export function App(){ return <Card view=\"outlined\"><Text variant=\"header-1\">agent-loop app</Text><Text>{format(new Date(0), 'yyyy-MM-dd')}</Text><Button view=\"action\"><Gear />act</Button><Panel /></Card>; }\n",
  '/src/Panel.jsx':
    'import { Label, Text } from \'@gravity-ui/uikit\'; export function Panel(){ return <div><Label theme="info">bench-seed</Label><Text variant="body-1">iteration bench-seed</Text></div>; }\n',
  '/express-anchor.cjs':
    "const marker=process.argv[2];const started=performance.now();const express=require('express');const app=express();const server=app.listen(4197,'127.0.0.1',()=>{const elapsed=performance.now()-started;console.log(`RIFTY_EXPRESS_READY ${marker} ${elapsed}`);server.close((error)=>{if(error)throw error;console.log(`RIFTY_EXPRESS_CLOSED ${marker}`);});});\n",
});

const CANONICAL_SCENARIO = Object.freeze({
  id: 'child-fs-hot-path-v1',
  root: '/bench',
  dependencies: DEPENDENCIES,
  files: FILES,
});

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function rawSample(lane: 'product-coi' | 'in-realm', ordinal: number) {
  const marker = `${lane}-${ordinal}`;
  return {
    lane,
    topology: lane === 'product-coi' ? 'owner-sync-rpc-kernel-child' : 'single-in-realm-worker',
    ordinal,
    ownerLoad: 'idle',
    vite: {
      exitCode: 0,
      rawOutput: VITE_GOLDEN.rawOutput,
      emittedJavaScript: `const marker = ${JSON.stringify(marker)};`,
      marker,
    },
    express: {
      exitCode: 0,
      rawOutput: `RIFTY_EXPRESS_READY ${marker} 34.25\nRIFTY_EXPRESS_CLOSED ${marker}\n`,
      marker,
    },
  };
}

function expectedSample(lane: 'product-coi' | 'in-realm', ordinal: number) {
  const input = rawSample(lane, ordinal);
  return {
    ...input,
    vite: { ...input.vite, transformedModules: 2195, selfTimeSeconds: 0.908 },
    express: { ...input.express, startToListeningMs: 34.25 },
  };
}

function completeSamples(runs = 2): readonly ReturnType<typeof rawSample>[] {
  return (['product-coi', 'in-realm'] as const).flatMap((lane) =>
    Array.from({ length: runs }, (_, index) => rawSample(lane, index + 1)),
  );
}

async function subject() {
  return Promise.all([import('../child-fs/scenario.mjs'), import('./child-fs-artifact.mjs')]);
}

describe('child fs canonical scenario and artifact authority', () => {
  it('pins real Vite 7.3.6 output for the exact canonical dependency set', () => {
    expect(VITE_GOLDEN).toEqual({
      schemaVersion: 1,
      scenarioId: 'child-fs-hot-path-v1',
      command: './node_modules/.bin/vite build --clearScreen false',
      exitCode: 0,
      viteVersion: 'vite/7.3.6 darwin-arm64 node-v24.16.0',
      dependencies: DEPENDENCIES,
      rawOutput: '✓ 2195 modules transformed.\n✓ built in 908ms\n',
    });
  });

  it('owns exact guest bytes/dependencies and derives both digests', async () => {
    const [{ childFsScenario, childFsScenarioIdentity }] = await subject();
    expect(childFsScenario()).toEqual(CANONICAL_SCENARIO);
    expect(childFsScenarioIdentity()).toEqual({
      scenarioDigest: sha256(CANONICAL_SCENARIO),
      dependencyDigest: sha256(DEPENDENCIES),
    });
  });

  it('derives raw anchor facts and preserves every unrounded sample/provenance field', async () => {
    const [, { buildChildFsArtifact, validateChildFsArtifact }] = await subject();
    const artifact = validateChildFsArtifact(
      buildChildFsArtifact({
        generatedAt: '2026-08-26T00:00:00.000Z',
        gitSha: 'c'.repeat(40),
        browserVersion: 'Chromium 140.0.7339.16',
        runs: 2,
        samples: completeSamples(),
      }),
    );
    expect(artifact).toMatchObject({
      schemaVersion: 1,
      generatedAt: '2026-08-26T00:00:00.000Z',
      gitSha: 'c'.repeat(40),
      browserVersion: 'Chromium 140.0.7339.16',
      runs: 2,
      scenarioDigest: sha256(CANONICAL_SCENARIO),
      dependencyDigest: sha256(DEPENDENCIES),
    });
    expect(artifact.samples).toEqual([
      expectedSample('product-coi', 1),
      expectedSample('product-coi', 2),
      expectedSample('in-realm', 1),
      expectedSample('in-realm', 2),
    ]);
    expect(artifact.samples[0]?.vite.rawOutput).toBe(completeSamples()[0]?.vite.rawOutput);
    expect(artifact.samples[0]?.express.rawOutput).toBe(completeSamples()[0]?.express.rawOutput);
    expect(Object.keys(artifact).sort()).toEqual([
      'browserVersion',
      'dependencyDigest',
      'generatedAt',
      'gitSha',
      'runs',
      'samples',
      'scenarioDigest',
      'schemaVersion',
    ]);

    const alternateInputs = completeSamples(1).map((entry, index) => ({
      ...entry,
      vite: {
        ...entry.vite,
        rawOutput:
          index === 0
            ? '✓ 17 modules transformed.\n✓ built in 1.234567s\n'
            : '✓ 23 modules transformed.\n✓ built in 250.123ms\n',
      },
      express: {
        ...entry.express,
        rawOutput: `RIFTY_EXPRESS_READY ${entry.express.marker} ${index === 0 ? '7.654321' : '8.987654'}\nRIFTY_EXPRESS_CLOSED ${entry.express.marker}\n`,
      },
    }));
    const alternate = validateChildFsArtifact(
      buildChildFsArtifact({
        generatedAt: '2026-08-26T00:00:01.000Z',
        gitSha: 'd'.repeat(40),
        browserVersion: 'Chromium alternate',
        runs: 1,
        samples: alternateInputs,
      }),
    );
    expect(
      alternate.samples.map(({ vite, express }) => ({
        modules: vite.transformedModules,
        viteSeconds: vite.selfTimeSeconds,
        expressMs: express.startToListeningMs,
      })),
    ).toEqual([
      { modules: 17, viteSeconds: 1.234567, expressMs: 7.654321 },
      { modules: 23, viteSeconds: 0.250123, expressMs: 8.987654 },
    ]);
  });

  it('parses real terminal CSI around Vite facts without projecting raw output', async () => {
    const [, { validateChildFsRawSample }] = await subject();
    const input = rawSample('product-coi', 7);
    const rawOutput =
      'transforming (2160) dependency.js\u001b[2K\u001b[1G\u001b[32m✓\u001b[39m 2180 modules transformed.\n' +
      'rendering chunks (1)...\u001b[2K\u001b[1G\u001b[32m✓ built in 6.06s\u001b[39m\n';
    const parsed = validateChildFsRawSample({
      ...input,
      vite: { ...input.vite, rawOutput },
    });
    expect(parsed.vite).toMatchObject({
      rawOutput,
      transformedModules: 2180,
      selfTimeSeconds: 6.06,
    });
  });

  it('rejects every corrupt Vite raw proof and caller-invented derived field', async () => {
    const [, { buildChildFsArtifact }] = await subject();
    const base = rawSample('product-coi', 1);
    const corruptions: ReadonlyArray<readonly [string, Readonly<Record<string, unknown>>]> = [
      ['non-zero exit', { exitCode: 1 }],
      ['non-positive module count', { rawOutput: '✓ 0 modules transformed.\n✓ built in 908ms\n' }],
      ['negative module count', { rawOutput: '✓ -1 modules transformed.\n✓ built in 908ms\n' }],
      ['missing module count', { rawOutput: '✓ built in 908ms\n' }],
      ['duplicate module count', { rawOutput: `${base.vite.rawOutput}${base.vite.rawOutput}` }],
      ['missing self time', { rawOutput: '✓ 2195 modules transformed.\n' }],
      ['zero self time', { rawOutput: '✓ 2195 modules transformed.\n✓ built in 0ms\n' }],
      ['negative self time', { rawOutput: '✓ 2195 modules transformed.\n✓ built in -1s\n' }],
      ['duplicate self time', { rawOutput: `${base.vite.rawOutput}✓ built in 1.64s\n` }],
      ['missing emitted marker', { emittedJavaScript: 'const marker = "other";' }],
      [
        'duplicate emitted marker',
        { emittedJavaScript: `${base.vite.marker} ${base.vite.marker}` },
      ],
      ['caller-derived field', { transformedModules: 2180 }],
      ['caller-derived self time', { selfTimeSeconds: 1.63 }],
    ];
    for (const [label, patch] of corruptions) {
      expect(
        () =>
          buildChildFsArtifact({
            generatedAt: '2026-08-26T00:00:00.000Z',
            gitSha: 'c'.repeat(40),
            browserVersion: 'Chromium 140.0.7339.16',
            runs: 1,
            samples: [{ ...base, vite: { ...base.vite, ...patch } }, rawSample('in-realm', 1)],
          }),
        label,
      ).toThrow();
    }
  });

  it('rejects every corrupt Express raw proof and caller-invented derived field', async () => {
    const [, { buildChildFsArtifact }] = await subject();
    const base = rawSample('product-coi', 1);
    const corruptions: ReadonlyArray<readonly [string, Readonly<Record<string, unknown>>]> = [
      ['non-zero exit', { exitCode: 1 }],
      ['missing ready', { rawOutput: `RIFTY_EXPRESS_CLOSED ${base.express.marker}\n` }],
      ['missing close', { rawOutput: `RIFTY_EXPRESS_READY ${base.express.marker} 34.25\n` }],
      [
        'close before ready',
        {
          rawOutput: `RIFTY_EXPRESS_CLOSED ${base.express.marker}\nRIFTY_EXPRESS_READY ${base.express.marker} 34.25\n`,
        },
      ],
      [
        'duplicate ready',
        { rawOutput: `${base.express.rawOutput}RIFTY_EXPRESS_READY ${base.express.marker} 1\n` },
      ],
      [
        'duplicate close',
        { rawOutput: `${base.express.rawOutput}RIFTY_EXPRESS_CLOSED ${base.express.marker}\n` },
      ],
      [
        'mismatched close',
        {
          rawOutput: `RIFTY_EXPRESS_READY ${base.express.marker} 34.25\nRIFTY_EXPRESS_CLOSED other\n`,
        },
      ],
      ['foreign ready', { rawOutput: `${base.express.rawOutput}RIFTY_EXPRESS_READY other 1\n` }],
      ['foreign close', { rawOutput: `${base.express.rawOutput}RIFTY_EXPRESS_CLOSED other\n` }],
      [
        'foreign full pair',
        {
          rawOutput: `${base.express.rawOutput}RIFTY_EXPRESS_READY other 1\nRIFTY_EXPRESS_CLOSED other\n`,
        },
      ],
      [
        'non-positive time',
        {
          rawOutput: `RIFTY_EXPRESS_READY ${base.express.marker} 0\nRIFTY_EXPRESS_CLOSED ${base.express.marker}\n`,
        },
      ],
      [
        'negative time',
        {
          rawOutput: `RIFTY_EXPRESS_READY ${base.express.marker} -1\nRIFTY_EXPRESS_CLOSED ${base.express.marker}\n`,
        },
      ],
      ['caller-derived field', { startToListeningMs: 34.25 }],
    ];
    for (const [label, patch] of corruptions) {
      expect(
        () =>
          buildChildFsArtifact({
            generatedAt: '2026-08-26T00:00:00.000Z',
            gitSha: 'c'.repeat(40),
            browserVersion: 'Chromium 140.0.7339.16',
            runs: 1,
            samples: [
              { ...base, express: { ...base.express, ...patch } },
              rawSample('in-realm', 1),
            ],
          }),
        label,
      ).toThrow();
    }
  });

  it('rejects partial/duplicate samples and malformed/extra artifacts through both entries', async () => {
    const [, { buildChildFsArtifact, validateChildFsArtifact, validateChildFsRawSample }] =
      await subject();
    expect(validateChildFsRawSample(rawSample('product-coi', 1))).toEqual(
      expectedSample('product-coi', 1),
    );
    const buildCorruptions = [
      completeSamples().slice(0, -1),
      completeSamples().map((entry, index) => (index === 1 ? { ...entry, ordinal: 1 } : entry)),
      completeSamples().filter((entry) => entry.lane !== 'in-realm'),
      [...completeSamples(), rawSample('product-coi', 3)],
      completeSamples().map((entry, index, samples) => {
        if (index !== 1) return entry;
        const marker = samples[0]?.vite.marker;
        if (marker === undefined) throw new Error('fixture marker missing');
        return {
          ...entry,
          vite: { ...entry.vite, marker, emittedJavaScript: `const marker = "${marker}";` },
          express: {
            ...entry.express,
            marker,
            rawOutput: `RIFTY_EXPRESS_READY ${marker} 34.25\nRIFTY_EXPRESS_CLOSED ${marker}\n`,
          },
        };
      }),
      completeSamples().map((entry, index) =>
        index === 0 ? { ...entry, unexpected: 'multiplier' } : entry,
      ),
    ];
    for (const samples of buildCorruptions) {
      expect(() =>
        buildChildFsArtifact({
          generatedAt: '2026-08-26T00:00:00.000Z',
          gitSha: 'c'.repeat(40),
          browserVersion: 'Chromium 140.0.7339.16',
          runs: 2,
          samples,
        }),
      ).toThrow();
    }

    const buildInput = {
      generatedAt: '2026-08-26T00:00:00.000Z',
      gitSha: 'c'.repeat(40),
      browserVersion: 'Chromium 140.0.7339.16',
      runs: 2,
      samples: completeSamples(),
    };
    expect(() => buildChildFsArtifact({ ...buildInput, scenarioDigest: 'd'.repeat(64) })).toThrow();
    expect(() =>
      buildChildFsArtifact({ ...buildInput, dependencyDigest: 'e'.repeat(64) }),
    ).toThrow();
    expect(() => buildChildFsArtifact({ ...buildInput, speedupX: 1.44 })).toThrow();
    expect(() => buildChildFsArtifact({ ...buildInput, summary: {} })).toThrow();

    const valid = buildChildFsArtifact(buildInput);
    for (const corrupt of [
      { ...valid, speedupX: 1.44 },
      { ...valid, summary: {} },
      { ...valid, samples: valid.samples.slice(0, -1) },
      { ...valid, samples: [...valid.samples, expectedSample('product-coi', 3)] },
      { ...valid, scenarioDigest: 'd'.repeat(64) },
      { ...valid, dependencyDigest: 'e'.repeat(64) },
      { ...valid, browserVersion: '' },
      { ...valid, generatedAt: '' },
      {
        ...valid,
        samples: valid.samples.map((entry, index) =>
          index === 1 ? { ...entry, ordinal: 1 } : entry,
        ),
      },
      {
        ...valid,
        samples: valid.samples.map((entry, index) =>
          index === 0 ? { ...entry, topology: 'single-in-realm-worker' } : entry,
        ),
      },
      {
        ...valid,
        samples: valid.samples.map((entry, index) =>
          index === 0 ? { ...entry, ownerLoad: 'busy-but-labelled-idle' } : entry,
        ),
      },
      {
        ...valid,
        samples: valid.samples.map((entry, index) => {
          if (index !== 1) return entry;
          const marker = valid.samples[0]?.vite.marker;
          if (marker === undefined) throw new Error('fixture marker missing');
          return {
            ...entry,
            vite: { ...entry.vite, marker, emittedJavaScript: `const marker = "${marker}";` },
            express: {
              ...entry.express,
              marker,
              rawOutput: `RIFTY_EXPRESS_READY ${marker} 34.25\nRIFTY_EXPRESS_CLOSED ${marker}\n`,
            },
          };
        }),
      },
      {
        ...valid,
        samples: valid.samples.map((entry, index) =>
          index === 0 ? { ...entry, vite: { ...entry.vite, rawOutput: 'forged' } } : entry,
        ),
      },
      {
        ...valid,
        samples: valid.samples.map((entry, index) =>
          index === 2 ? { ...entry, vite: { ...entry.vite, selfTimeSeconds: 999 } } : entry,
        ),
      },
      {
        ...valid,
        samples: valid.samples.map((entry, index) =>
          index === 3
            ? { ...entry, express: { ...entry.express, startToListeningMs: 999 } }
            : entry,
        ),
      },
      {
        ...valid,
        samples: valid.samples.map((entry, index) =>
          index === 1 ? { ...entry, vite: { ...entry.vite, marker: 'forged' } } : entry,
        ),
      },
      {
        ...valid,
        samples: valid.samples.map((entry, index) =>
          index === 0 ? { ...entry, express: { ...entry.express, extra: true } } : entry,
        ),
      },
    ]) {
      expect(() => validateChildFsArtifact(corrupt)).toThrow();
    }
  });
});
