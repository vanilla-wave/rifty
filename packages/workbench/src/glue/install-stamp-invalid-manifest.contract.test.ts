import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, expect, it } from 'vitest';
import { createOwnerVfsAuthorityComposition } from '../workers/owner-vfs-authority.ts';
import { createInstallStampAuthority } from './install-stamp-authority.ts';
import { parseInstallStamp } from './install-stamp.ts';
import { SyncMirrorVfs } from './sync-mirror-vfs.ts';

const ROOT = '/project';
const MANIFEST = `${ROOT}/package.json`;
const PRIOR_JSON = '{"name":"prior","dependencies":{}}\n';
const INCOMING_JSON = '{"name":"incoming","dependencies":{}}\n';
const enc = new TextEncoder();
const dec = new TextDecoder();

afterEach(resetSyncMirror);

it.each([
  [true, 'malformed'],
  [true, 'directory'],
  [true, 'missing'],
  [false, 'malformed'],
  [false, 'directory'],
  [false, 'missing'],
] as const)(
  'demotes prior=%s with a %s manifest before real replacement',
  async (withPrior, shape) => {
    const pair = createMemoryFs();
    const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
      initialRoots: ['/', '/.rifty'],
    });
    const vfs = new SyncMirrorVfs();
    setSyncMirror(authority, { async: vfs });
    const io = { vfs, fsSync: authority, claimIo: installStampClaims };
    const stamps = createInstallStampAuthority(io);
    const flush = () => authority.flush();
    const identity = { root: ROOT, slug: 'project', packageJsonText: PRIOR_JSON };
    authority.mkdirSync(`${ROOT}/node_modules/local`, { recursive: true });
    authority.writeFileSync(`${ROOT}/node_modules/local/index.js`, enc.encode('prior bytes\n'));
    authority.writeFileSync(MANIFEST, enc.encode(PRIOR_JSON));
    if (withPrior) {
      const claim = await stamps.demote(identity, { flush });
      expect(
        await stamps.promote(identity, { epoch: claim.epoch, packages: 1, flush }),
      ).toMatchObject({
        status: 'trusted',
      });
    }
    authority.rmSync(MANIFEST, { force: true });
    if (shape === 'malformed') authority.writeFileSync(MANIFEST, enc.encode('{invalid\n'));
    if (shape === 'directory') {
      authority.mkdirSync(MANIFEST, { recursive: true });
      authority.writeFileSync(`${MANIFEST}/saved.txt`, enc.encode('saved directory\n'));
    }
    await flush();

    const claim = await stamps.demote(identity);
    await flush();
    expect(await stamps.check(identity)).toEqual({ status: 'pending' });
    const retired = installStampClaims.read(ROOT);
    if (retired !== null) {
      expect(parseInstallStamp(JSON.parse(dec.decode(retired)), ROOT)).toMatchObject({
        durability: 'pending',
        epoch: claim.epoch,
        packageJsonText: PRIOR_JSON,
      });
    }
    if (!withPrior) expect(retired).toBeNull();
    expect(['absent', 'pending']).toContain(
      (await createInstallStampAuthority(io).check(identity)).status,
    );
    if (shape === 'missing') expect(authority.existsSync(MANIFEST)).toBe(false);
    if (shape === 'malformed')
      expect(dec.decode(authority.readFileBytesSync(MANIFEST))).toBe('{invalid\n');
    if (shape === 'directory') {
      expect(authority.statSync(MANIFEST).isDirectory).toBe(true);
      expect(dec.decode(authority.readFileBytesSync(`${MANIFEST}/saved.txt`))).toBe(
        'saved directory\n',
      );
    }
    expect(dec.decode(authority.readFileBytesSync(`${ROOT}/node_modules/local/index.js`))).toBe(
      'prior bytes\n',
    );

    authority.rmSync(MANIFEST, { force: true, recursive: true });
    authority.writeFileSync(MANIFEST, enc.encode(INCOMING_JSON));
    const incoming = { ...identity, packageJsonText: INCOMING_JSON };
    expect(
      await stamps.promote(incoming, { epoch: claim.epoch, packages: 1, flush }),
    ).toMatchObject({
      status: 'trusted',
      stamp: { packageJsonText: INCOMING_JSON },
    });
    await flush();
    expect(await createInstallStampAuthority(io).check(incoming)).toMatchObject({
      status: 'trusted',
    });
  },
);
