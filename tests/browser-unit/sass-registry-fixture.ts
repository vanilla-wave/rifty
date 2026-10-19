import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type BrowserContext, expect } from '@playwright/test';
import closure from '../../tools/shadow-registry/src/fixtures/sass-1.100.0-closure.json' with {
  type: 'json',
};
import buildOracle from '../../tools/shadow-registry/src/fixtures/sass-vite-7.3.6-node-build.json' with {
  type: 'json',
};

/**
 * Keep the HTTP input identical to the frozen Node oracle; install real npm bytes. The Sass
 * closure is served from committed tarballs; every other package of the oracle's npm lock is
 * resolved from its live packument trimmed to the locked version (a fresh install today would
 * otherwise pick newer releases than the oracle built with, e.g. rollup 4.64.10 vs 4.63.5).
 */
export async function serveSassViteOracleRegistry(context: BrowserContext): Promise<void> {
  for (const fixture of closure.packages) {
    const path = fileURLToPath(
      new URL(
        `../../tools/shadow-registry/src/fixtures/${fixture.name}-${fixture.version}.tgz`,
        import.meta.url,
      ),
    );
    const bytes = readFileSync(path);
    expect(bytes.length).toBe(fixture.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixture.sha256);
    expect(`sha512-${createHash('sha512').update(bytes).digest('base64')}`).toBe(fixture.integrity);
    const manifest = JSON.parse(
      execFileSync('tar', ['-xzOf', path, 'package/package.json'], { encoding: 'utf8' }),
    ) as Record<string, unknown>;
    expect(manifest.name).toBe(fixture.name);
    expect(manifest.version).toBe(fixture.version);
    expect(manifest.dependencies ?? {}).toEqual(fixture.dependencies);
    const metadataPath = `/npm-registry/${fixture.name}`;
    const tarballPath = `/npm-registry${new URL(fixture.tarball).pathname}`;
    await context.route(
      (url) => url.pathname === metadataPath,
      (route) =>
        route.fulfill({
          json: {
            name: fixture.name,
            'dist-tags': { latest: fixture.version },
            versions: {
              [fixture.version]: {
                ...manifest,
                dist: { tarball: fixture.tarball, integrity: fixture.integrity },
              },
            },
          },
        }),
    );
    await context.route(
      (url) => url.pathname === tarballPath,
      (route) => route.fulfill({ body: bytes, contentType: 'application/octet-stream' }),
    );
  }
  await freezeOracleLockClosure(context, new Set(closure.packages.map(({ name }) => name)));
}

async function freezeOracleLockClosure(
  context: BrowserContext,
  served: ReadonlySet<string>,
): Promise<void> {
  const lockBytes = readFileSync(
    fileURLToPath(new URL(`../../${buildOracle.lockFixture.path}`, import.meta.url)),
  );
  expect(createHash('sha256').update(lockBytes).digest('hex')).toBe(buildOracle.lockFixture.sha256);
  const lock = JSON.parse(lockBytes.toString('utf8')) as {
    readonly packages: Record<string, { readonly version?: string; readonly integrity?: string }>;
  };
  const locked = new Map<string, { readonly version: string; readonly integrity?: string }>();
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key === '' || entry.version === undefined) continue;
    const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (served.has(name)) continue;
    const previous = locked.get(name)?.version;
    if (previous !== undefined && previous !== entry.version) {
      throw new Error(`oracle lock records ${name} at ${previous} and ${entry.version}`);
    }
    locked.set(name, { version: entry.version, integrity: entry.integrity });
  }
  const packumentName = (url: URL): string | undefined => {
    const path = decodeURIComponent(url.pathname);
    return path.startsWith('/npm-registry/') ? path.slice('/npm-registry/'.length) : undefined;
  };
  await context.route(
    (url) => locked.has(packumentName(url) ?? ''),
    async (route) => {
      const name = packumentName(new URL(route.request().url())) ?? '';
      const pin = locked.get(name);
      if (pin === undefined) throw new Error(`no oracle lock entry for ${name}`);
      const response = await route.fetch();
      const packument = (await response.json()) as {
        readonly versions?: Record<string, { readonly dist?: { readonly integrity?: string } }>;
        readonly time?: Record<string, string>;
      };
      const manifest = packument.versions?.[pin.version];
      if (manifest === undefined)
        throw new Error(`registry no longer serves ${name}@${pin.version}`);
      if (pin.integrity !== undefined) expect(manifest.dist?.integrity).toBe(pin.integrity);
      const time = packument.time?.[pin.version];
      // Fresh headers: the upstream content-encoding/length describe the untrimmed body.
      await route.fulfill({
        status: response.status(),
        json: {
          ...packument,
          'dist-tags': { latest: pin.version },
          versions: { [pin.version]: manifest },
          ...(time === undefined ? {} : { time: { [pin.version]: time } }),
        },
      });
    },
  );
}
