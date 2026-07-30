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
    ]) {
      expect(gate, dependency).toContain(`- ${dependency}`);
    }
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
