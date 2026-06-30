import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// Drive the SAME depcruise CLI + config that `pnpm check:arch` runs in CI.
const DEPCRUISE = 'node_modules/.bin/depcruise';

// Fixtures live INSIDE the repo (not under tests/, which options.exclude drops) so
// depcruise yields clean cwd-relative paths and `solid-js` resolves via root node_modules.
const FIXTURE_BASE = join(process.cwd(), '.arch-fixtures');
mkdirSync(FIXTURE_BASE, { recursive: true });
afterAll(() => rmSync(FIXTURE_BASE, { recursive: true, force: true }));

/** Materialize {relativePath: contents}; return the fixture root, cwd-relative. */
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(FIXTURE_BASE, 'fx-'));
  for (const [rel, src] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, src);
  }
  return relative(process.cwd(), root);
}

interface CruiseResult {
  summary: { violations: { rule: { name: string }; from: string; to: string }[] };
  modules: { dependencies: { module: string; resolved: string; couldNotResolve: boolean }[] }[];
}

function runArch(paths: string[]): CruiseResult {
  let stdout: string;
  try {
    stdout = execFileSync(
      DEPCRUISE,
      ['--config', '.dependency-cruiser.cjs', '--output-type', 'json', ...paths],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (e) {
    // depcruise exits non-zero when violations exist; the JSON is still on stdout
    stdout = (e as { stdout?: Buffer | string }).stdout?.toString() ?? '';
    if (!stdout) throw e;
  }
  return JSON.parse(stdout);
}

const ruleNames = (paths: string[]) => runArch(paths).summary.violations.map((v) => v.rule.name);

describe('check:arch layer boundaries', () => {
  it('flags a reverse import (low tier importing a higher tier)', () => {
    const root = fixture({
      'vfs/src/a.ts': "import '../../kernel/src/b';\nexport const a = 1;\n",
      'kernel/src/b.ts': 'export const b = 2;\n',
    });
    expect(ruleNames([root])).toContain('no-reverse-import-vfs');
  });

  it('allows a downward import (high tier importing a lower tier)', () => {
    const root = fixture({
      'kernel/src/a.ts': "import '../../vfs/src/b';\nexport const a = 1;\n",
      'vfs/src/b.ts': 'export const b = 2;\n',
    });
    expect(ruleNames([root]).filter((n) => n.startsWith('no-reverse-import'))).toEqual([]);
  });

  it('flags an import cycle', () => {
    const root = fixture({
      'vfs/src/a.ts': "import '../../io/src/b';\nexport const a = 1;\n",
      'io/src/b.ts': "import '../../vfs/src/a';\nexport const b = 2;\n",
    });
    expect(ruleNames([root])).toContain('no-circular');
  });

  it('flags reaching into another package src/internal (deep, non-index)', () => {
    const root = fixture({
      'kernel/src/a.ts': "import '../../vfs/src/internal/secret';\nexport const a = 1;\n",
      'vfs/src/internal/secret.ts': 'export const s = 1;\n',
    });
    expect(ruleNames([root])).toContain('no-foreign-internal');
  });

  it('allows another package internal via its declared ./internal index entry', () => {
    const root = fixture({
      'kernel/src/a.ts': "import '../../vfs/src/internal/index';\nexport const a = 1;\n",
      'vfs/src/internal/index.ts': 'export const s = 1;\n',
    });
    expect(ruleNames([root])).not.toContain('no-foreign-internal');
  });

  it('flags solid-js imported outside playground (D-002)', () => {
    const root = fixture({ 'shell/src/a.ts': "import 'solid-js';\nexport const a = 1;\n" });
    expect(ruleNames([root])).toContain('solid-only-in-playground');
  });

  it('allows solid-js inside playground', () => {
    const root = fixture({ 'playground/src/a.ts': "import 'solid-js';\nexport const a = 1;\n" });
    expect(ruleNames([root])).not.toContain('solid-only-in-playground');
  });

  it('resolves cross-package subpath exports (madge blindspot regression)', () => {
    const edges = runArch(['packages/runtime-js/src/worker-entry.ts']).modules.flatMap(
      (m) => m.dependencies,
    );
    const sub = edges.find((d) => d.module === '@riftydev/vfs/internal');
    expect(sub, '@riftydev/vfs/internal edge present').toBeDefined();
    expect(sub?.couldNotResolve).toBe(false);
    expect(sub?.resolved).toContain('vfs/src/internal');
  });

  it('the real codebase passes check:arch', () => {
    const viol = runArch(['packages', 'apps', 'tools', 'services']).summary.violations;
    expect(viol.map((v) => `${v.rule.name} ${v.from}→${v.to}`)).toEqual([]);
  });
});
