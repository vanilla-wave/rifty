import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertFixtureProvenance } from '../../tests/no-coi/build-fixtures.mjs';
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

/** The `steps:` list of a job block, one raw text chunk per step. Step-scoped
 * parsing is the point: a run/if/env/continue-on-error key means nothing
 * except on the step that EXECUTES the pinned command. */
function jobSteps(job: string): string[] {
  const lines = job.split('\n');
  const start = lines.findIndex((l) => /^ {4}steps:\s*$/u.test(l));
  const steps: string[] = [];
  if (start === -1) return steps;
  let current: string[] | null = null;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (/^ {6}- /u.test(line)) {
      if (current !== null) steps.push(current.join('\n'));
      current = [line];
    } else if (current !== null) {
      current.push(line);
    }
  }
  if (current !== null) steps.push(current.join('\n'));
  return steps;
}

/** Every step `run:` value in a job/step text, parsed to the exact executable
 * string: plain scalars get their trailing YAML comment stripped; `run: |`
 * block scalars are joined verbatim. */
function stepRuns(text: string): string[] {
  const runs: string[] = [];
  const lines = text.split('\n');
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

/** Every mapping key in the YAML text — block entries, inline maps, AND
 * single/double-QUOTED keys (`'continue-on-error':` is the same key to the
 * runner; a bare-identifier regex is a provenance lie) — ignoring comments. */
function yamlKeys(text: string): Set<string> {
  const keys = new Set<string>();
  const keyPattern = /(?:'([^']+)'|"([^"]+)"|([A-Za-z][\w-]*)):/gu;
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('#')) continue;
    const lead = line.match(new RegExp(`^\\s*(?:- )?${keyPattern.source}`, 'u'));
    if (lead !== null) keys.add(lead[1] ?? lead[2] ?? lead[3] ?? '');
    for (const m of line.matchAll(new RegExp(`[{,]\\s*${keyPattern.source}`, 'gu'))) {
      keys.add(m[1] ?? m[2] ?? m[3] ?? '');
    }
  }
  return keys;
}

/** The `if:` condition of ONE step's text, null when unconditional. */
function stepIf(step: string): string | null {
  const m = step.match(/^\s*(?:- )?if:\s*(.*)$/mu);
  return m === null ? null : (m[1] ?? '').trim();
}

/** The `env:` map of ONE step's text, parsed to exact key→value. */
function stepEnv(step: string): Record<string, string> {
  const lines = step.split('\n');
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

/** job → the exact suite command its verdict must come from. */
const SUITE_RUNS = [
  ['no-coi-chromium', 'pnpm test:no-coi'],
  ['browser-unit-chromium', 'pnpm test:browser-unit'],
  [
    'e2e-chromium',
    "pnpm test:e2e:${{ matrix.lane }} ${{ matrix.lane == 'light' && '--workers=1' || '' }} ${{ matrix.shardTotal && format('--shard={0}/{1}', matrix.shard, matrix.shardTotal) || '' }}",
  ],
  ['unit-and-conformance', 'pnpm test:${{ matrix.suite }}'],
] as const;

const GATE_RUN = 'node tools/checks/ci-gate.mjs';
const GATE_ENV: Record<string, string> = {
  CODE: '${{ needs.change-scope.outputs.code }}',
  CHANGE_SCOPE_RESULT: '${{ needs.change-scope.result }}',
  LINT_RESULT: '${{ needs.lint-and-typecheck.result }}',
  UNIT_RESULT: '${{ needs.unit-and-conformance.result }}',
  E2E_RESULT: '${{ needs.e2e-chromium.result }}',
  BROWSER_UNIT_RESULT: '${{ needs.browser-unit-chromium.result }}',
  NO_COI_RESULT: '${{ needs.no-coi-chromium.result }}',
};

/** The ONE step of `job` that executes `run` — throws when the step is
 * missing, duplicated, DISABLED (`if:` on the exact step), or verdict-softened
 * (continue-on-error, quoted or not). Semantic detection pinned by the mutant
 * sweep below. */
function executableSuiteStep(workflow: string, job: string, run: string): string {
  const steps = jobSteps(jobBlock(workflow, job)).filter((s) => stepRuns(s).includes(run));
  if (steps.length !== 1) {
    throw new Error(`${job}: expected exactly one step running '${run}', found ${steps.length}`);
  }
  const step = steps[0] ?? '';
  const cond = stepIf(step);
  if (cond !== null) {
    throw new Error(`${job}: the '${run}' step is disabled behind if: ${cond} — never executes`);
  }
  if (yamlKeys(step).has('continue-on-error')) {
    throw new Error(`${job}: continue-on-error on the '${run}' step softens its verdict`);
  }
  return step;
}

/** Whole executable topology as ONE throwing checker so semantic mutants can
 * be swept against it: exact suite step per gated job + gate, no disabled
 * steps, no (quoted) continue-on-error anywhere, gate env ON the gate step. */
function assertWorkflowExecutionTopology(workflow: string): void {
  if (yamlKeys(workflow).has('continue-on-error')) {
    throw new Error('continue-on-error present in workflow (block, inline, or quoted key)');
  }
  for (const [job, run] of SUITE_RUNS) executableSuiteStep(workflow, job, run);
  const gateStep = executableSuiteStep(workflow, 'ci-gate', GATE_RUN);
  // The env map must ride the EXECUTING gate step: a byte-identical map on a
  // sibling step (checkout, a decoy) feeds the script nothing.
  const env = stepEnv(gateStep);
  const wantKeys = Object.keys(GATE_ENV).sort().join(',');
  const gotKeys = Object.keys(env).sort().join(',');
  if (gotKeys !== wantKeys || Object.keys(GATE_ENV).some((k) => env[k] !== GATE_ENV[k])) {
    throw new Error(
      `ci-gate: env map must ride the executing gate step exactly; got ${JSON.stringify(env)}`,
    );
  }
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

  it('classifies events like the workflow will see them: push/merge_group full gate, docs-only pull_request code=false (sibling sweep)', () => {
    const script = join(process.cwd(), 'tools/checks/ci-change-scope.mjs');
    for (const event of ['push', 'merge_group']) {
      const out = execFileSync('node', [script, event, '', ''], { encoding: 'utf8' });
      expect(out.trim(), event).toBe('code=true');
    }
    const root = mkdtempSync(join(tmpdir(), 'rifty-ci-scope-'));
    try {
      git(root, 'init', '-b', 'main');
      mkdirSync(join(root, 'docs'), { recursive: true });
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(join(root, 'docs/README.md'), 'base\n');
      writeFileSync(join(root, 'src/index.ts'), 'export {};\n');
      const base = commit(root, 'base');
      writeFileSync(join(root, 'docs/README.md'), 'docs change\n');
      const docsHead = commit(root, 'docs');
      writeFileSync(join(root, 'src/index.ts'), 'export const changed = true;\n');
      const codeHead = commit(root, 'code');

      const classify = (b: string, h: string) =>
        execFileSync('node', [script, 'pull_request', b, h], {
          cwd: root,
          encoding: 'utf8',
        }).trim();
      expect(classify(base, docsHead), 'docs-only PR').toBe('code=false');
      expect(classify(docsHead, codeHead), 'code PR').toBe('code=true');
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

    // ADR-0323 §3 classified set — no-coi-chromium is deliberately NOT here.
    for (const job of ['unit-and-conformance', 'e2e-chromium', 'browser-unit-chromium']) {
      const block = jobBlock(workflow, job);
      expect(block, job).toContain('needs: change-scope');
      // A bare `needs.*` condition implies success() and silently skips the
      // heavy suite when change-scope dies; !cancelled() + != 'false' fails
      // open to the full gate (ADR-0323 §2, fault class false-fallback).
      expect(block, job).toContain(
        "if: ${{ !cancelled() && needs.change-scope.outputs.code != 'false' }}",
      );
    }

    // no-coi-chromium is UNCONDITIONAL like lint (ADR-0369 correction): a
    // docs-only classification skipping it would green a READY RED-first
    // substrate's PR between Contract+RED and fix (false-fallback). No
    // job-level `if:`/`needs:` — it runs on every pull_request/merge_group/
    // push event; the gate requires its success on every path
    // (ci-gate.test.ts sweeps code / docs-only / classifier-failure).
    const noCoiJob = jobBlock(workflow, 'no-coi-chromium');
    expect(noCoiJob).not.toMatch(/^ {4}if:/mu);
    expect(noCoiJob).not.toMatch(/^ {4}needs:/mu);

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
    // another job's result. Every hop is PARSED per STEP and compared as an
    // exact executable value — never a substring pin: `pnpm test:no-coi ||
    // true` still CONTAINS the suite command; only exact equality rejects it.
    // Semantic step/env mutants against this checker: next test.
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };

    assertWorkflowExecutionTopology(workflow);
    // The gate job's ONLY run step is the gate script itself.
    expect(stepRuns(jobBlock(workflow, 'ci-gate'))).toEqual([GATE_RUN]);

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

    // config → executed topology, read from the IMPORTED config objects (the
    // exact values Playwright executes), not a source grep of the config text.
    const [noCoi, browserUnit, prod, dflt] = (await Promise.all([
      import('../../playwright.no-coi.config.ts'),
      import('../../playwright.browser-unit.config.ts'),
      import('../../playwright.prod.config.ts'),
      import('../../playwright.config.ts'),
    ])) as {
      default: {
        testDir?: string;
        projects?: { name?: string }[];
        globalSetup?: string;
        webServer?: { command?: string; reuseExistingServer?: boolean };
      } & Record<string, unknown>;
    }[];
    expect(noCoi?.default.testDir).toBe('./tests/no-coi');
    // testDir alone is not the executed lane: an alternate headerless server,
    // a swapped globalSetup, or a testIgnore/grep excluding a spec all keep
    // testDir intact. Pin every hop the lane executes.
    expect(noCoi?.default.globalSetup).toBe('./tests/no-coi/global-setup.ts');
    expect(noCoi?.default.webServer?.command).toBe('node tests/no-coi/server.mjs');
    expect(noCoi?.default.webServer?.reuseExistingServer).toBe(false);
    for (const knob of ['testMatch', 'testIgnore', 'grep', 'grepInvert']) {
      expect(noCoi?.default[knob], `no-coi ${knob} must not narrow discovery`).toBeUndefined();
    }
    expect(browserUnit?.default.testDir).toBe('./tests/browser-unit');
    expect(prod?.default.testDir).toBe('./tests/e2e-prod');
    // heavy/light ride the default config (no --config flag → playwright.config.ts).
    expect(dflt?.default.testDir).toBe('./tests/e2e');
    const projectNames = (dflt?.default.projects ?? []).map((p) => p.name);
    expect(projectNames).toContain('chromium-heavy');
    expect(projectNames).toContain('chromium-light');
  });

  it('rejects semantic YAML step/env mutants across every gated job and the gate (disabled exact step, quoted continue-on-error, detached gate env)', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    // Sanity: the real workflow passes the checker the mutants run against.
    assertWorkflowExecutionTopology(workflow);

    const runLineOf = (job: string, run: string): string => {
      const line = jobSteps(jobBlock(workflow, job))
        .flatMap((s) => s.split('\n'))
        .find((l) => stepRuns(l).includes(run));
      expect(line, `${job} run line`).toBeDefined();
      expect(workflow.split(line ?? '').length, `${job} run line unique`).toBe(2);
      return line ?? '';
    };

    for (const [job, run] of [...SUITE_RUNS, ['ci-gate', GATE_RUN] as const]) {
      const line = runLineOf(job, run);
      const ws = line.match(/^\s*/u)?.[0] ?? '';
      const indent = line.trimStart().startsWith('- ') ? `${ws}  ` : ws;
      // Replacement via callback: the run lines carry `${{ … }}` which the
      // string-replacement `$` patterns would mangle.
      // Disabled exact step: the run VALUE is still present verbatim — a
      // textual membership pin passes; the step never executes.
      const disabled = workflow.replace(line, () => `${line}\n${indent}if: \${{ false }}`);
      expect(() => assertWorkflowExecutionTopology(disabled), `${job} disabled`).toThrowError(
        /disabled behind if/,
      );
      // Quoted soft-fail key: same key to the runner, invisible to a
      // bare-identifier key regex.
      const softened = workflow.replace(line, () => `${line}\n${indent}'continue-on-error': true`);
      expect(() => assertWorkflowExecutionTopology(softened), `${job} quoted coe`).toThrowError(
        /continue-on-error/,
      );
    }

    // Detached env: the byte-identical env map rides the gate job's CHECKOUT
    // step; the executing gate step has none. A job-scoped "first env map"
    // extraction still finds the decoy and passes.
    const envMatch = workflow.match(
      /( {8}env:\n(?: {10}\S[^\n]*\n)+)( {8}run: node tools\/checks\/ci-gate\.mjs)/u,
    );
    expect(envMatch, 'gate env block').not.toBeNull();
    const [, envBlock, gateRunLine] = envMatch ?? [];
    const anchor = '      - uses: actions/checkout@v4\n      - name: Require every applicable job';
    expect(workflow, 'gate checkout anchor').toContain(anchor);
    const detached = workflow
      .replace(`${envBlock ?? ''}${gateRunLine ?? ''}`, () => gateRunLine ?? '')
      .replace(
        anchor,
        () =>
          `      - uses: actions/checkout@v4\n${envBlock ?? ''}      - name: Require every applicable job`,
      );
    expect(() => assertWorkflowExecutionTopology(detached)).toThrowError(
      /env map must ride the executing gate step/,
    );
  });

  it('discovers exactly the committed no-coi specs through the executed config, and globalSetup builds provenance-checked fixtures', async () => {
    // testDir+knob pins above prove the CONFIG; this proves what Playwright
    // actually discovers through it — a stray testMatch on disk, a renamed
    // spec, or a config hop swap surfaces here as a changed file list.
    const out = execFileSync(
      'pnpm',
      [
        'exec',
        'playwright',
        'test',
        '--config',
        'playwright.no-coi.config.ts',
        '--list',
        '--reporter=json',
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    const report = JSON.parse(out) as { suites?: { file?: string }[] };
    const files = [...new Set((report.suites ?? []).map((s) => s.file ?? ''))].sort();
    expect(files).toEqual([
      'build-provenance.no-coi.spec.ts',
      'header-provenance.no-coi.spec.ts',
      'worker-realm-compat.no-coi.spec.ts',
    ]);

    // globalSetup→builder hop EXECUTED, not narrated: run the module the
    // config names and assert the metafile provenance it must produce.
    const setup = (await import('../../tests/no-coi/global-setup.ts')) as {
      default: () => Promise<void>;
    };
    await setup.default();
    const metafile = JSON.parse(
      readFileSync('tests/no-coi/fixtures/dist/metafile.json', 'utf8'),
    ) as unknown;
    expect(() => assertFixtureProvenance(metafile)).not.toThrow();
  }, 120_000);
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
