import type { MemoryVfs, PersistFailureReport } from '@riftydev/vfs';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import {
  type OwnerVfsAuthority,
  createOwnerVfsAuthorityComposition,
} from '../workers/owner-vfs-authority.ts';
import { installArtifactIdentity } from './install-artifact-identity.ts';
import {
  type InstallStampAuthority,
  type InstallStampClaimIo,
  type InstallStampTransitionOptions,
  createInstallStampAuthority,
} from './install-stamp-authority.ts';
import { type InstallStamp, parseInstallStamp, readInstallStamp } from './install-stamp.ts';

const SOURCE_ROOT = '/scratch';
const TARGET_ROOT = '/projects/saved-vite';
const SOURCE_SLUG = 'vite-scratch';
const TARGET_SLUG = 'saved-vite';
const SOURCE_PACKAGES = 17;
const PACKAGE_JSON = `${JSON.stringify({
  name: 'vite-app',
  dependencies: { vite: '7.3.6' },
})}\n`;
const LOCKFILE = `${JSON.stringify({
  name: 'vite-app',
  lockfileVersion: 3,
  packages: {
    '': { dependencies: { vite: '7.3.6' } },
    'node_modules/vite': { version: '7.3.6' },
  },
})}\n`;
const ORDINARY_MARKER = 'vite-temp-bytes-survive-save\n';
const NESTED_SUFFIX = 'examples/nested';
const NESTED_SOURCE_ROOT = `${SOURCE_ROOT}/${NESTED_SUFFIX}`;
const NESTED_TARGET_ROOT = `${TARGET_ROOT}/${NESTED_SUFFIX}`;

type ProjectSaveRebindResult = { status: 'untrusted' } | { status: 'trusted'; stamp: InstallStamp };

interface ExpectedProjectSaveInstallStampAuthority extends InstallStampAuthority {
  rebindProjectSave(
    input: {
      source: { root: string; slug: string };
      target: { root: string; slug: string };
    },
    options?: InstallStampTransitionOptions,
  ): Promise<ProjectSaveRebindResult>;
}

type ClaimWriteFailure = 'pending' | 'trusted';

interface Harness {
  readonly vfs: MemoryVfs;
  readonly owner: OwnerVfsAuthority;
  readonly claims: InstallStampClaimIo;
  readonly stamps: InstallStampAuthority;
  readonly flush: () => Promise<PersistFailureReport | undefined>;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function claimPhase(root: string, bytes: Uint8Array): ClaimWriteFailure | null {
  try {
    const parsed: unknown = JSON.parse(dec.decode(bytes));
    const stamp = parseInstallStamp(parsed, root);
    if (!stamp) return null;
    return stamp.durability === 'pending' ? 'pending' : 'trusted';
  } catch {
    return null;
  }
}

function faultingClaimStorage(
  storage: InstallStampClaimIo,
  failure: ClaimWriteFailure,
): InstallStampClaimIo {
  return {
    read: (root) => storage.read(root),
    write: (root, data, options) => {
      if (root === TARGET_ROOT && claimPhase(root, data) === failure) {
        throw new Error(`QuotaExceededError: target ${failure} claim write`);
      }
      storage.write(root, data, options);
    },
    remove: (root) => storage.remove(root),
  };
}

function createHarness(claimWriteFailure?: ClaimWriteFailure): Harness {
  const pair = createMemoryFs();
  const composition = createOwnerVfsAuthorityComposition(pair.fsSync, {
    ownerEpoch: 'project-save-test-owner',
  });
  const claims =
    claimWriteFailure === undefined
      ? composition.installStampClaims
      : faultingClaimStorage(composition.installStampClaims, claimWriteFailure);
  const stamps = createInstallStampAuthority({
    vfs: pair.vfs,
    fsSync: composition.authority,
    claimIo: claims,
  });
  return {
    vfs: pair.vfs,
    owner: composition.authority,
    claims,
    stamps,
    flush: () => composition.authority.flush(),
  };
}

function writeText(owner: OwnerVfsAuthority, path: string, text: string): void {
  owner.writeFileSync(path, enc.encode(text));
}

function seedProject(
  h: Harness,
  root: string,
  options: {
    readonly packageJsonText?: string;
    readonly lockfileText?: string | null;
  } = {},
): void {
  const packageJsonText = options.packageJsonText ?? PACKAGE_JSON;
  const lockfileText = options.lockfileText === undefined ? LOCKFILE : options.lockfileText;
  h.owner.mkdirSync(`${root}/node_modules/vite`, { recursive: true });
  h.owner.mkdirSync(`${root}/node_modules/.vite-temp`, { recursive: true });
  writeText(h.owner, `${root}/package.json`, packageJsonText);
  writeText(h.owner, `${root}/node_modules/vite/package.json`, '{"version":"7.3.6"}\n');
  writeText(h.owner, `${root}/node_modules/.vite-temp/save-marker`, ORDINARY_MARKER);
  if (lockfileText !== null) writeText(h.owner, `${root}/package-lock.json`, lockfileText);
}

async function mintTrusted(
  h: Harness,
  root: string,
  slug: string,
  packages: number,
): Promise<InstallStamp> {
  const packageJsonText = await h.vfs.readFileText(`${root}/package.json`);
  const claim = await h.stamps.demote({ root, slug }, { flush: h.flush });
  const promoted = await h.stamps.promote(
    { root, slug, packageJsonText },
    { epoch: claim.epoch, packages, flush: h.flush },
  );
  if (promoted.status !== 'trusted') {
    throw new Error(`test setup failed to trust ${root}: ${promoted.status}`);
  }
  return promoted.stamp;
}

async function arrangeTrustedSave(
  h: Harness,
  options: { readonly includeNestedProject?: boolean } = {},
): Promise<void> {
  seedProject(h, SOURCE_ROOT);
  seedProject(h, TARGET_ROOT);
  await mintTrusted(h, SOURCE_ROOT, SOURCE_SLUG, SOURCE_PACKAGES);
  if (options.includeNestedProject) {
    seedProject(h, NESTED_SOURCE_ROOT);
    seedProject(h, NESTED_TARGET_ROOT);
    await mintTrusted(h, NESTED_SOURCE_ROOT, 'nested-scratch', 2);
  }
}

function invokeProjectSaveRebind(
  authority: InstallStampAuthority,
  input: {
    readonly source: { readonly root: string; readonly slug: string };
    readonly target: { readonly root: string; readonly slug: string };
  } = {
    source: { root: SOURCE_ROOT, slug: SOURCE_SLUG },
    target: { root: TARGET_ROOT, slug: TARGET_SLUG },
  },
  options?: InstallStampTransitionOptions,
): Promise<ProjectSaveRebindResult> {
  const expected = authority as ExpectedProjectSaveInstallStampAuthority;
  if (typeof expected.rebindProjectSave !== 'function') {
    throw new Error('expected InstallStampAuthority.rebindProjectSave API');
  }
  return expected.rebindProjectSave(input, options);
}

function rewriteClaim(
  h: Harness,
  root: string,
  mutate: (claim: Record<string, unknown>) => void,
): void {
  const bytes = h.claims.read(root);
  if (!bytes) throw new Error(`test setup failed: missing claim at ${root}`);
  const parsed: unknown = JSON.parse(dec.decode(bytes));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`test setup failed: invalid claim at ${root}`);
  }
  const claim = parsed as Record<string, unknown>;
  mutate(claim);
  h.claims.write(root, enc.encode(`${JSON.stringify(claim, null, 2)}\n`), {
    mkdirTree: false,
  });
}

async function expectSourceTrusted(h: Harness): Promise<void> {
  await expect(h.stamps.check({ root: SOURCE_ROOT, slug: SOURCE_SLUG })).resolves.toMatchObject({
    status: 'trusted',
  });
}

async function expectTargetNotTrusted(h: Harness): Promise<void> {
  const stamp = await readInstallStamp(h.vfs, TARGET_ROOT);
  expect(stamp === null || stamp.durability === 'pending').toBe(true);
  await expect(h.stamps.check({ root: TARGET_ROOT, slug: TARGET_SLUG })).resolves.not.toMatchObject(
    { status: 'trusted' },
  );
}

function hiddenStorageFailure(path: string): PersistFailureReport {
  const sampled = '/unrelated/cache.json';
  return {
    failures: [{ path: sampled, op: 'write', message: 'QuotaExceededError' }],
    total: 2,
    anyFailure: (predicate) => predicate(sampled) || predicate(path),
  };
}

describe('ADR-0329 install-stamp project Save rebind', () => {
  it('mints a new target-root/slug v4 claim from an exact trusted source', async () => {
    const h = createHarness();
    await arrangeTrustedSave(h, { includeNestedProject: true });
    const sourceStamp = await readInstallStamp(h.vfs, SOURCE_ROOT);
    if (!sourceStamp) throw new Error('test setup failed: missing source claim');

    const result = await invokeProjectSaveRebind(h.stamps, undefined, { flush: h.flush });

    expect(result).toEqual({
      status: 'trusted',
      stamp: {
        version: 4,
        root: TARGET_ROOT,
        slug: TARGET_SLUG,
        packageJsonText: PACKAGE_JSON,
        installArtifactIdentity,
        lockfileSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        deps: { vite: '7.3.6' },
        packages: SOURCE_PACKAGES,
      },
    });
    if (result.status !== 'trusted') throw new Error('expected trusted Save rebind');
    expect(result.stamp.lockfileSha256).toBe(sourceStamp.lockfileSha256);
    expect(await readInstallStamp(h.vfs, TARGET_ROOT)).toEqual(result.stamp);
    expect(await h.vfs.readFileText(`${TARGET_ROOT}/node_modules/.vite-temp/save-marker`)).toBe(
      ORDINARY_MARKER,
    );
    await expectSourceTrusted(h);
    await expect(
      h.stamps.check({ root: NESTED_SOURCE_ROOT, slug: 'nested-scratch' }),
    ).resolves.toMatchObject({ status: 'trusted' });
    expect(await readInstallStamp(h.vfs, NESTED_TARGET_ROOT)).toBeNull();
  });

  const sourceRefusals: readonly {
    readonly name: string;
    readonly startsTrusted: boolean;
    readonly mutate: (h: Harness) => void | Promise<void>;
  }[] = [
    {
      name: 'has no claim',
      startsTrusted: false,
      mutate: () => {},
    },
    {
      name: 'is pending',
      startsTrusted: true,
      mutate: async (h) => {
        await h.stamps.demote({ root: SOURCE_ROOT, slug: SOURCE_SLUG }, { flush: h.flush });
      },
    },
    {
      name: 'has corrupt claim bytes',
      startsTrusted: true,
      mutate: (h) => {
        h.claims.write(SOURCE_ROOT, enc.encode('{not-json'), { mkdirTree: false });
      },
    },
    {
      name: 'has a stale v3 claim',
      startsTrusted: true,
      mutate: (h) =>
        rewriteClaim(h, SOURCE_ROOT, (claim) => {
          claim.version = 3;
        }),
    },
    {
      name: 'has the wrong embedded root',
      startsTrusted: true,
      mutate: (h) =>
        rewriteClaim(h, SOURCE_ROOT, (claim) => {
          claim.root = '/wrong-root';
        }),
    },
    {
      name: 'has the wrong slug',
      startsTrusted: true,
      mutate: (h) =>
        rewriteClaim(h, SOURCE_ROOT, (claim) => {
          claim.slug = 'other-project';
        }),
    },
    {
      name: 'has the wrong install artifact identity',
      startsTrusted: true,
      mutate: (h) =>
        rewriteClaim(h, SOURCE_ROOT, (claim) => {
          claim.installArtifactIdentity = `sha256:${'0'.repeat(64)}`;
        }),
    },
    {
      name: 'has package.json byte drift',
      startsTrusted: true,
      mutate: (h) => {
        writeText(
          h.owner,
          `${SOURCE_ROOT}/package.json`,
          `${JSON.stringify({
            name: 'vite-app',
            dependencies: { vite: '7.3.6', picocolors: '1.1.1' },
          })}\n`,
        );
      },
    },
    {
      name: 'has lockfile byte drift',
      startsTrusted: true,
      mutate: (h) => {
        writeText(h.owner, `${SOURCE_ROOT}/package-lock.json`, `${LOCKFILE.trim()}\n \n`);
      },
    },
  ];

  it.each(sourceRefusals)(
    'leaves the copied target untrusted when the source $name',
    async ({ startsTrusted, mutate }) => {
      const h = createHarness();
      seedProject(h, SOURCE_ROOT);
      seedProject(h, TARGET_ROOT);
      if (startsTrusted) {
        await mintTrusted(h, SOURCE_ROOT, SOURCE_SLUG, SOURCE_PACKAGES);
      }
      await mutate(h);

      const result = await invokeProjectSaveRebind(h.stamps, undefined, { flush: h.flush });

      expect(result).toEqual({ status: 'untrusted' });
      expect(await readInstallStamp(h.vfs, TARGET_ROOT)).toBeNull();
      await expect(h.stamps.check({ root: TARGET_ROOT, slug: TARGET_SLUG })).resolves.toEqual({
        status: 'absent',
      });
    },
  );

  it('refuses to rebind one root under a different target slug', async () => {
    const h = createHarness();
    seedProject(h, SOURCE_ROOT);
    await mintTrusted(h, SOURCE_ROOT, SOURCE_SLUG, SOURCE_PACKAGES);

    const operation = invokeProjectSaveRebind(
      h.stamps,
      {
        source: { root: SOURCE_ROOT, slug: SOURCE_SLUG },
        target: { root: SOURCE_ROOT, slug: TARGET_SLUG },
      },
      { flush: h.flush },
    );

    await expect(operation).rejects.toThrow();
    await expectSourceTrusted(h);
  });

  it('refuses target package.json bytes that differ from the trusted source', async () => {
    const h = createHarness();
    await arrangeTrustedSave(h);
    writeText(
      h.owner,
      `${TARGET_ROOT}/package.json`,
      `${JSON.stringify({
        name: 'vite-app',
        dependencies: { vite: '7.3.6' },
        scripts: { dev: 'vite' },
      })}\n`,
    );

    const operation = invokeProjectSaveRebind(h.stamps, undefined, { flush: h.flush });

    await expect(operation).rejects.toThrow();
    await expectSourceTrusted(h);
    expect(await readInstallStamp(h.vfs, TARGET_ROOT)).toBeNull();
  });

  it('refuses target lockfile bytes that differ from the trusted source fact', async () => {
    const h = createHarness();
    await arrangeTrustedSave(h);
    writeText(h.owner, `${TARGET_ROOT}/package-lock.json`, `${LOCKFILE.trim()}\n \n`);

    const operation = invokeProjectSaveRebind(h.stamps, undefined, { flush: h.flush });

    await expect(operation).rejects.toThrow();
    await expectSourceTrusted(h);
    expect(await readInstallStamp(h.vfs, TARGET_ROOT)).toBeNull();
  });

  it('refuses to overwrite a pre-existing target claim', async () => {
    const h = createHarness();
    await arrangeTrustedSave(h);
    const existing = await mintTrusted(h, TARGET_ROOT, 'existing-project', 3);

    const operation = invokeProjectSaveRebind(h.stamps, undefined, { flush: h.flush });

    await expect(operation).rejects.toThrow();
    await expectSourceTrusted(h);
    expect(await readInstallStamp(h.vfs, TARGET_ROOT)).toEqual(existing);
    await expect(
      h.stamps.check({ root: TARGET_ROOT, slug: 'existing-project' }),
    ).resolves.toMatchObject({ status: 'trusted' });
  });

  it('refuses a target with corrupt raw claim bytes', async () => {
    const h = createHarness();
    await arrangeTrustedSave(h);
    h.claims.write(TARGET_ROOT, enc.encode('{not-json'), { mkdirTree: false });

    const operation = invokeProjectSaveRebind(h.stamps, undefined, { flush: h.flush });

    await expect(operation).rejects.toThrow();
    await expectSourceTrusted(h);
    expect(h.claims.read(TARGET_ROOT)).toEqual(enc.encode('{not-json'));
  });

  it('refuses a target whose copied dependency tree is missing', async () => {
    const h = createHarness();
    await arrangeTrustedSave(h);
    h.owner.rmSync(`${TARGET_ROOT}/node_modules`, { recursive: true });

    const operation = invokeProjectSaveRebind(h.stamps, undefined, { flush: h.flush });

    await expect(operation).rejects.toThrow();
    await expectSourceTrusted(h);
    expect(await readInstallStamp(h.vfs, TARGET_ROOT)).toBeNull();
  });

  it('rejects Save when the target pending claim cannot be written', async () => {
    const h = createHarness('pending');
    await arrangeTrustedSave(h);

    const operation = invokeProjectSaveRebind(h.stamps, undefined, { flush: h.flush });

    await expect(operation).rejects.toThrow();
    await expectSourceTrusted(h);
    expect(await readInstallStamp(h.vfs, TARGET_ROOT)).toBeNull();
  });

  it('rejects Save when the full ledger reports hidden target-tree damage', async () => {
    const h = createHarness();
    await arrangeTrustedSave(h);
    const operation = invokeProjectSaveRebind(h.stamps, undefined, {
      flush: async () => hiddenStorageFailure(`${TARGET_ROOT}/node_modules/vite/package.json`),
    });

    await expect(operation).rejects.toThrow();
    await expectSourceTrusted(h);
    await expectTargetNotTrusted(h);
  });

  it('rejects Save when final target promotion cannot publish its claim', async () => {
    const h = createHarness('trusted');
    await arrangeTrustedSave(h);

    const operation = invokeProjectSaveRebind(h.stamps, undefined, { flush: h.flush });

    await expect(operation).rejects.toThrow();
    await expectSourceTrusted(h);
    await expectTargetNotTrusted(h);
  });
});
