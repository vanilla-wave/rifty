import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findInstallStampWriterViolations,
  isProductionTypeScript,
  scanInstallStampWriters,
} from './install-stamp-writers.mjs';

const FILE = 'packages/workbench/src/glue/example.ts';

function operations(source: string): string[] {
  return findInstallStampWriterViolations(source, FILE).map((violation) => violation.operation);
}

describe('install-stamp one-writer gate', () => {
  it('rejects direct and aliased async/sync claim mutations', () => {
    expect(
      operations(`
        const first = installStampPath(root);
        const second = first;
        await vfs.writeFile(second, bytes);
        fs.rmSync(\`${'${root}'}/node_modules/.rifty-install-stamp.json\`, { force: true });
      `),
    ).toEqual(['writeFile', 'rmSync']);
  });

  it('follows local path producers and mutation wrappers', () => {
    expect(
      operations(`
        function claimPath(root: string) { return installStampPath(root); }
        function persist(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); }
        const writeClaim = (path: string, bytes: Uint8Array) => persist(path, bytes);
        writeClaim(claimPath(root), bytes);
      `),
    ).toEqual(['writeClaim']);
  });

  it('follows aliased filesystem mutators', () => {
    expect(
      operations(`
        const writeClaim = fs.writeFileSync;
        const removeClaim = vfs.rm.bind(vfs);
        writeClaim(installStampPath(root), bytes);
        await removeClaim(installStampPath(root), { force: true });
      `),
    ).toEqual(['writeClaim', 'removeClaim']);
  });

  it('follows destructured filesystem mutators', () => {
    expect(
      operations(`
        const { copyFileSync: copyClaim } = fs;
        copyClaim('/tmp/claim.json', installStampPath(root));
      `),
    ).toEqual(['copyClaim']);
  });

  it('rejects install-tree ancestor mutations and helper calls outside acquisition', () => {
    expect(
      operations(`
        fs.rmSync(joinPath(root, 'node_modules'), { recursive: true, force: true });
        clearProjectTree(fs, root);
        finalizePackageInstallFiles({ root });
        prepareProjectInstallTree(fs, root, opts);
        seedTemplateNodeModulesFiles(config);
      `),
    ).toEqual([
      'rmSync',
      'clearProjectTree',
      'finalizePackageInstallFiles',
      'prepareProjectInstallTree',
      'seedTemplateNodeModulesFiles',
    ]);
  });

  it('allows package-tree primitives only inside acquisition adapter callbacks', () => {
    const bootstrap = 'packages/workbench/src/workers/owner-package-state.ts';
    expect(
      findInstallStampWriterViolations(
        `
          const prepareEnsure = async () => clearProjectTree(fs, root);
          const planSnapshotRestore = async () => seedTemplateNodeModulesFiles(config);
          const install = async () => {
            prepareProjectInstallTree(fs, root, opts);
            finalizePackageInstallFiles({ root });
          };
          const reassertTemplateNodeModules = async () => seedTemplateNodeModulesFiles(config);
          const reset = async () => clearProjectTree(fs, root);
          const switchProject = async () => clearProjectTree(fs, root);
          const boot = async () => clearProjectTree(fs, root);
          const finalize = async () => finalizePackageInstallFiles({ root });
          const retry = async () => prepareProjectInstallTree(fs, root, opts);
        `,
        bootstrap,
      ).map((violation) => violation.operation),
    ).toEqual(['clearProjectTree', 'finalizePackageInstallFiles', 'prepareProjectInstallTree']);
  });

  it('rejects both operands of move/copy mutations', () => {
    expect(
      operations(`
        fs.renameSync(installStampPath(a), '/tmp/claim.json');
        fs.copyFileSync('/tmp/claim.json', installStampPath(b));
        fs.cpSync(installStampPath(c), installStampPath(d));
      `),
    ).toEqual(['renameSync', 'copyFileSync', 'cpSync', 'cpSync']);
  });

  it('allows reads, comparisons, comments, and filename text used as payload', () => {
    expect(
      operations(`
        // .rifty-install-stamp.json is a claim.
        const path = installStampPath(root);
        await vfs.exists(path);
        await vfs.readFileText(path);
        fs.readFileBytesSync(path);
        const failed = failure.path === \`${'${root}'}/node_modules/.rifty-install-stamp.json\`;
        await vfs.writeFile('/log.txt', '.rifty-install-stamp.json');
      `),
    ).toEqual([]);
  });

  it('exempts the authority and excludes tests/specs from repository scanning', () => {
    expect(
      findInstallStampWriterViolations(
        'vfs.writeFile(installStampPath(root), bytes)',
        'packages/workbench/src/glue/install-stamp-authority.ts',
      ),
    ).toEqual([]);
    expect(isProductionTypeScript('packages/workbench/src/a.test.ts')).toBe(false);
    expect(isProductionTypeScript('packages/workbench/src/a.test-fixture.ts')).toBe(false);
    expect(isProductionTypeScript('packages/workbench/src/a.spec.tsx')).toBe(false);
    expect(isProductionTypeScript(FILE)).toBe(true);
  });

  it('scans production Playground writers while excluding Playground tests', () => {
    const root = mkdtempSync(join(tmpdir(), 'install-stamp-writers-'));
    try {
      mkdirSync(join(root, 'packages/workbench/src'), { recursive: true });
      mkdirSync(join(root, 'apps/playground/src'), { recursive: true });
      writeFileSync(join(root, 'packages/workbench/src/safe.ts'), 'export const safe = true;');
      writeFileSync(
        join(root, 'apps/playground/src/claim-writer.ts'),
        'vfs.writeFile(installStampPath(root), bytes);',
      );
      writeFileSync(
        join(root, 'apps/playground/src/claim-writer.test.ts'),
        'vfs.writeFile(installStampPath(root), bytes);',
      );

      expect(
        scanInstallStampWriters(root).map(({ file, operation }) => ({ file, operation })),
      ).toEqual([
        {
          file: 'apps/playground/src/claim-writer.ts',
          operation: 'writeFile',
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('allows only the Owner construction-local claim capability, not ordinary writes', () => {
    const owner = 'packages/workbench/src/workers/owner-vfs-authority.ts';
    expect(
      findInstallStampWriterViolations(
        `
          class Owner {
            #writeInstallStampClaim(root: string, bytes: Uint8Array) {
              const path = installStampPath(root);
              this.#fs.mkdirSync(installTreeDir(root), { recursive: true });
              this.#fs.writeFileSync(path, bytes);
            }
            #removeInstallStampClaim(root: string) {
              this.#fs.rmSync(installStampPath(root), { force: true });
            }
            writeFileSync(root: string, bytes: Uint8Array) {
              const forged = installStampPath(root);
              this.#fs.writeFileSync(forged, bytes);
              this.#fs.writeFileSync(\`${'${root}'}/node_modules/.rifty-install-stamp.json\`, bytes);
            }
          }
        `,
        owner,
      ).map((violation) => violation.operation),
    ).toEqual(['writeFileSync', 'writeFileSync']);
  });
});
