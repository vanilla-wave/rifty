import { describe, expect, it } from 'vitest';
import {
  findInstallStampWriterViolations,
  isProductionTypeScript,
} from './install-stamp-writers.mjs';

const FILE = 'apps/playground/src/glue/example.ts';

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
    const bootstrap = 'apps/playground/src/workers/owner-package-state.ts';
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
        'apps/playground/src/glue/install-stamp-authority.ts',
      ),
    ).toEqual([]);
    expect(isProductionTypeScript('apps/playground/src/a.test.ts')).toBe(false);
    expect(isProductionTypeScript('apps/playground/src/a.spec.tsx')).toBe(false);
    expect(isProductionTypeScript(FILE)).toBe(true);
  });

  it('allows only the Owner construction-local claim capability, not ordinary writes', () => {
    const owner = 'apps/playground/src/workers/owner-vfs-authority.ts';
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
