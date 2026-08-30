import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NODE_CLI_EVAL_ORACLE_VERSION } from '../node-parity-runner/src/node-cli-eval.ts';
import {
  changedPathsBetween,
  isDocumentationOnlyPath,
  requiresHeavyCi,
} from './ci-change-scope.mjs';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commit(cwd: string, message: string): string {
  git(cwd, 'add', '.');
  git(cwd, '-c', 'user.name=Rifty', '-c', 'user.email=rifty@example.test', 'commit', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

function jobBlock(workflow: string, job: string): string {
  const marker = `  ${job}:\n`;
  const start = workflow.indexOf(marker);
  expect(start, `${job} job`).toBeGreaterThanOrEqual(0);
  const rest = workflow.slice(start + marker.length);
  const nextJob = rest.search(/^ {2}[a-z][a-z0-9-]*:\n/mu);
  return nextJob === -1 ? rest : rest.slice(0, nextJob);
}

function nodeVersions(job: string): string[] {
  return Array.from(
    job.matchAll(/^\s+node-version:\s+([^#\s]+)(?:\s+#.*)?$/gmu),
    (match) => match[1] ?? '',
  );
}

/** Every step `run:` value in a job block, parsed to the exact executable
 * string: plain scalars get their trailing YAML comment stripped; `run: |`
 * block scalars are joined verbatim. */
function stepRuns(job: string): string[] {
  const runs: string[] = [];
  const lines = job.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i]?.match(/^(\s*)(?:- )?run:\s*(.*)$/u);
    if (match === null || match === undefined) continue;
    const value = match[2] ?? '';
    if (value === '|' || value === '>') {
      const bodyIndent = (match[1] ?? '').length + 2;
      const body: string[] = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        const bodyLine = lines[j] ?? '';
        if (bodyLine.trim() === '') {
          body.push('');
          continue;
        }
        if ((bodyLine.match(/^\s*/u)?.[0].length ?? 0) < bodyIndent) break;
        body.push(bodyLine.slice(bodyIndent));
      }
      while (body.at(-1) === '') body.pop();
      runs.push(body.join('\n'));
    } else {
      runs.push(value.replace(/\s+#\s.*$/u, '').trim());
    }
  }
  return runs;
}

/** Every mapping key in the YAML text — block entries and inline maps —
 * ignoring comment lines. */
function yamlKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('#')) continue;
    for (const m of line.matchAll(/^\s*(?:- )?([A-Za-z][\w-]*):/gu)) keys.add(m[1] ?? '');
    for (const m of line.matchAll(/[{,]\s*([A-Za-z][\w-]*):/gu)) keys.add(m[1] ?? '');
  }
  return keys;
}

/** The first step `env:` map in a job block, parsed to exact key→value. */
function stepEnv(job: string): Record<string, string> {
  const lines = job.split('\n');
  const start = lines.findIndex((l) => /^\s+env:\s*$/u.test(l));
  const out: Record<string, string> = {};
  if (start === -1) return out;
  const entryIndent = (lines[start]?.match(/^\s*/u)?.[0].length ?? 0) + 2;
  for (let i = start + 1; i < lines.length; i += 1) {
    const m = lines[i]?.match(/^(\s*)([A-Z][A-Z0-9_]*):\s*(.*)$/u);
    if (m === null || m === undefined || (m[1] ?? '').length < entryIndent) break;
    out[m[2] ?? ''] = (m[3] ?? '').trim();
  }
  return out;
}

describe('CI change scope', () => {
  it('allows only explicit documentation paths to skip heavy tests', () => {
    for (const path of [
      'docs/backlog/net/server-address-full-shape.md',
      'docs/landing/handoff/Rifty.dc.html',
      'README.md',
      'packages/runtime-js/CHANGELOG.md',
      'packages/vfs/LICENSE',
      'AGENTS.md',
      'CLAUDE.md',
    ]) {
      expect(isDocumentationOnlyPath(path), path).toBe(true);
    }

    for (const path of [
      '.github/workflows/ci.yml',
      'pnpm-lock.yaml',
      'packages/runtime-js/src/index.ts',
      'packages/runtime-js/src/content.md',
      'tests/e2e/m0-boot.spec.ts',
    ]) {
      expect(isDocumentationOnlyPath(path), path).toBe(false);
    }

    expect(requiresHeavyCi(['docs/ROADMAP.md', 'packages/vfs/README.md'])).toBe(false);
    expect(requiresHeavyCi(['docs/ROADMAP.md', 'packages/vfs/src/index.ts'])).toBe(true);
    expect(requiresHeavyCi([])).toBe(true);
  });

  it('treats a source-to-docs rename as code-affecting', () => {
    const root = mkdtempSync(join(tmpdir(), 'rifty-ci-scope-'));
    try {
      git(root, 'init', '-b', 'main');
      mkdirSync(join(root, 'packages/runtime-js/src'), { recursive: true });
      mkdirSync(join(root, 'docs/reference'), { recursive: true });
      writeFileSync(join(root, 'packages/runtime-js/src/old.ts'), 'export {};\n');
      const base = commit(root, 'base');

      renameSync(join(root, 'packages/runtime-js/src/old.ts'), join(root, 'docs/reference/old.md'));
      const head = commit(root, 'move source into docs');

      const paths = changedPathsBetween(base, head, root);
      expect(paths).toEqual(['docs/reference/old.md', 'packages/runtime-js/src/old.ts']);
      expect(requiresHeavyCi(paths)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses the merge base so unrelated base-branch code does not taint a docs PR', () => {
    const root = mkdtempSync(join(tmpdir(), 'rifty-ci-scope-'));
    try {
      git(root, 'init', '-b', 'main');
      mkdirSync(join(root, 'docs'), { recursive: true });
      mkdirSync(join(root, 'packages/vfs/src'), { recursive: true });
      writeFileSync(join(root, 'docs/README.md'), 'base\n');
      writeFileSync(join(root, 'packages/vfs/src/index.ts'), 'export {};\n');
      commit(root, 'base');

      git(root, 'switch', '--quiet', '-c', 'docs-pr');
      writeFileSync(join(root, 'docs/README.md'), 'docs change\n');
      const docsHead = commit(root, 'docs');

      git(root, 'switch', '--quiet', 'main');
      writeFileSync(join(root, 'packages/vfs/src/index.ts'), 'export const changed = true;\n');
      const mainHead = commit(root, 'unrelated code on main');

      const paths = changedPathsBetween(mainHead, docsHead, root);
      expect(paths).toEqual(['docs/README.md']);
      expect(requiresHeavyCi(paths)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('gates every heavy matrix behind the classifier and reduces to one stable check', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(workflow).toContain('merge_group:');
    expect(workflow).not.toContain('paths-ignore:');
    expect(workflow).toContain('permissions:\n  contents: read');

    const scope = jobBlock(workflow, 'change-scope');
    expect(scope).toContain('fetch-depth: 0');
    expect(scope).toContain('node tools/checks/ci-change-scope.mjs');

    const lint = jobBlock(workflow, 'lint-and-typecheck');
    expect(lint).toContain('pnpm check:compat-drift');
    expect(lint).toContain('pnpm test:docs-contract');
    for (const contract of [
      'apps/playground/src/App.test.ts',
      'packages/service-worker/tests/preview-routing-docs.test.ts',
      'packages/ts-language-service/src/hard-ceil-source.test.ts',
      'tools/checks/esbuild-compat-matrix.test.ts',
      'tests/integration/landing-static.test.ts',
      'tests/integration/prod-npm-registry-proxy.test.ts',
    ]) {
      expect(packageJson.scripts['test:docs-contract'], contract).toContain(contract);
    }

    for (const job of [
      'unit-and-conformance',
      'e2e-chromium',
      'browser-unit-chromium',
      'no-coi-chromium',
    ]) {
      const block = jobBlock(workflow, job);
      expect(block, job).toContain('needs: change-scope');
      // A bare `needs.*` condition implies success() and silently skips the
      // heavy suite when change-scope dies; !cancelled() + != 'false' fails
      // open to the full gate (ADR-0323 §2, fault class false-fallback).
      expect(block, job).toContain(
        "if: ${{ !cancelled() && needs.change-scope.outputs.code != 'false' }}",
      );
    }

    const gate = jobBlock(workflow, 'ci-gate');
    expect(gate).toContain('name: CI gate');
    expect(gate).toContain('if: always()');
    expect(gate).toContain('node tools/checks/ci-gate.mjs');
    for (const dependency of [
      'change-scope',
      'lint-and-typecheck',
      'unit-and-conformance',
      'e2e-chromium',
      'browser-unit-chromium',
      'no-coi-chromium',
    ]) {
      expect(gate, dependency).toContain(`- ${dependency}`);
    }
  });

  it('pins the exact job→script→config→gate mapping for every gated suite (sibling sweep)', async () => {
    // A `needs`/`if` presence check alone lets a job run `true` or a SIBLING
    // suite, soften its verdict with continue-on-error, or feed the gate
    // another job's result. Every hop is PARSED and compared as an exact
    // executable value — never a substring pin: `pnpm test:no-coi || true`
    // still CONTAINS the suite command; only exact equality rejects it.
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };

    // No job may soften its verdict: a continue-on-error'd failure reports
    // success to the gate (provenance-lie). Parsed as YAML KEYS (block and
    // inline-map), never a text grep.
    expect(yamlKeys(workflow).has('continue-on-error')).toBe(false);

    // job → exact suite run value: array membership is whole-value equality,
    // so `run: true`, a sibling script, or an appended `|| true` fails here.
    for (const [job, run] of [
      ['no-coi-chromium', 'pnpm test:no-coi'],
      ['browser-unit-chromium', 'pnpm test:browser-unit'],
      [
        'e2e-chromium',
        "pnpm test:e2e:${{ matrix.lane }} ${{ matrix.lane == 'light' && '--workers=1' || '' }} ${{ matrix.shardTotal && format('--shard={0}/{1}', matrix.shard, matrix.shardTotal) || '' }}",
      ],
      ['unit-and-conformance', 'pnpm test:${{ matrix.suite }}'],
    ] as const) {
      expect(stepRuns(jobBlock(workflow, job)), job).toContain(run);
    }
    // Matrix axes parsed exact: the templated run values above resolve only
    // through these.
    const suiteAxis = jobBlock(workflow, 'unit-and-conformance').match(
      /^\s+suite:\s*\[([^\]]*)\]\s*$/mu,
    );
    expect(suiteAxis?.[1]?.split(',').map((s) => s.trim())).toEqual(['run', 'parity']);
    const lanes = Array.from(
      jobBlock(workflow, 'e2e-chromium').matchAll(/\{ lane: ([a-z]+)/gu),
      (m) => m[1],
    );
    expect([...new Set(lanes)].sort()).toEqual(['heavy', 'light', 'prod']);

    // script → whole executable value (exact — a sibling config, a dropped
    // flag, or a `|| true` all fail equality).
    for (const [script, value] of [
      ['test:no-coi', 'playwright test --config playwright.no-coi.config.ts'],
      ['test:browser-unit', 'playwright test --config playwright.browser-unit.config.ts'],
      ['test:e2e:prod', 'playwright test --config playwright.prod.config.ts --project=chromium'],
      ['test:e2e:heavy', 'playwright test --project=chromium-heavy --workers=1'],
      ['test:e2e:light', 'playwright test --project=chromium-light'],
      ['test:run', 'vitest run'],
      ['test:parity', 'tsx tools/node-parity-runner/src/cli.ts'],
    ] as const) {
      expect(packageJson.scripts[script], script).toBe(value);
    }

    // config → suite dir, read from the IMPORTED config objects (the exact
    // values Playwright executes), not a source grep of the config text.
    const [noCoi, browserUnit, prod, dflt] = (await Promise.all([
      import('../../playwright.no-coi.config.ts'),
      import('../../playwright.browser-unit.config.ts'),
      import('../../playwright.prod.config.ts'),
      import('../../playwright.config.ts'),
    ])) as { default: { testDir?: string; projects?: { name?: string }[] } }[];
    expect(noCoi?.default.testDir).toBe('./tests/no-coi');
    expect(browserUnit?.default.testDir).toBe('./tests/browser-unit');
    expect(prod?.default.testDir).toBe('./tests/e2e-prod');
    // heavy/light ride the default config (no --config flag → playwright.config.ts).
    expect(dflt?.default.testDir).toBe('./tests/e2e');
    const projectNames = (dflt?.default.projects ?? []).map((p) => p.name);
    expect(projectNames).toContain('chromium-heavy');
    expect(projectNames).toContain('chromium-light');

    // gate ← each job's OWN result: the step's WHOLE env map compared exact
    // (feeding a sibling's result, dropping or adding a key all fail), and the
    // gate's only run step is the gate script itself.
    const gate = jobBlock(workflow, 'ci-gate');
    expect(stepRuns(gate)).toEqual(['node tools/checks/ci-gate.mjs']);
    expect(stepEnv(gate)).toEqual({
      CODE: '${{ needs.change-scope.outputs.code }}',
      CHANGE_SCOPE_RESULT: '${{ needs.change-scope.result }}',
      LINT_RESULT: '${{ needs.lint-and-typecheck.result }}',
      UNIT_RESULT: '${{ needs.unit-and-conformance.result }}',
      E2E_RESULT: '${{ needs.e2e-chromium.result }}',
      BROWSER_UNIT_RESULT: '${{ needs.browser-unit-chromium.result }}',
      NO_COI_RESULT: '${{ needs.no-coi-chromium.result }}',
    });
  });
});

describe('CI Node CLI eval oracle', () => {
  it('pins every executable oracle carrier to the frozen Node patch', () => {
    const version = NODE_CLI_EVAL_ORACLE_VERSION.replace(/^v/u, '');
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    const crossBrowser = readFileSync('.github/workflows/ci-cross-browser.yml', 'utf8');

    for (const job of ['unit-and-conformance', 'e2e-chromium']) {
      expect(nodeVersions(jobBlock(ci, job)), job).toEqual([version]);
    }
    expect(nodeVersions(jobBlock(crossBrowser, 'e2e'))).toEqual([version]);
  });
});
