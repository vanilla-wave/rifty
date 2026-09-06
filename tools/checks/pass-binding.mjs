#!/usr/bin/env node
/**
 * Merge-time PASS binding (docs/process/rules/review.md REV-8): a PR that changes a product
 * path or a product test carries a landing verdict — `docs/backlog/<area>/reference/<slug>-final-green.json`
 * or `…-ordinary.json`, written by the runner with `reviewed_sha` — whose reviewed commit is an
 * ancestor of HEAD and from which every later change is documentation
 * (tools/checks/ci-change-scope.mjs). A draft PR is skipped: the binding is asked of a PR
 * marked ready to merge, never of work in flight.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDocumentationOnlyPath } from './ci-change-scope.mjs';
import { classifyAutonomousRunPath } from './run-pickup.mjs';

const SHA_RE = /^[0-9a-f]{40}$/u;
// The tree the binding protects: shipped product and the tests that prove it. Referee changes
// (tools/, CI, canon) are guarded by PR-4 and their own tests, never by a landing verdict.
const PRODUCT_TEST_ROOT_RE = /^(?:apps|packages|services|tests)\//u;
const LANDING_ARTIFACT_RE =
  /^docs\/backlog\/[^/]+\/reference\/[^/]+-(?:final-green|ordinary)\.json$/u;

/**
 * @param {{ changed: string[], readHead: (path: string) => string|null,
 *   isAncestor: (sha: string) => boolean, diffSince: (sha: string) => string[], draft: boolean }} input
 * @returns {{ status: 'ok'|'skipped'|'fail', reason: string, artifact?: string, sha?: string }}
 */
export function evaluateBinding({ changed, readHead, isAncestor, diffSince, draft }) {
  if (draft) return { status: 'skipped', reason: 'draft PR — binding is asked at ready-for-merge' };
  const product = changed.filter((path) => {
    const kind = classifyAutonomousRunPath(path);
    return kind === 'production' || (kind === 'test-support' && PRODUCT_TEST_ROOT_RE.test(path));
  });
  if (product.length === 0) return { status: 'skipped', reason: 'no product or test path changed' };
  const artifacts = changed.filter((path) => LANDING_ARTIFACT_RE.test(path));
  if (artifacts.length === 0) {
    return {
      status: 'fail',
      reason: `${product.length} product/test path(s) changed with no landing verdict artifact (REV-8)`,
    };
  }
  const failures = [];
  for (const artifact of artifacts) {
    let verdict = null;
    try {
      verdict = JSON.parse(readHead(artifact) ?? 'null');
    } catch {
      verdict = null;
    }
    const sha = verdict?.reviewed_sha;
    if (!SHA_RE.test(String(sha ?? ''))) {
      failures.push(`${artifact}: no 40-hex reviewed_sha`);
      continue;
    }
    if (!isAncestor(sha)) {
      failures.push(`${artifact}: reviewed_sha ${sha.slice(0, 12)} is not an ancestor of HEAD`);
      continue;
    }
    const broken = diffSince(sha).filter((path) => !isDocumentationOnlyPath(path));
    if (broken.length === 0) return { status: 'ok', reason: 'bound', artifact, sha };
    failures.push(
      `${artifact}: ${broken.length} non-documentation path(s) changed after reviewed_sha ${sha.slice(0, 12)}: ${broken.slice(0, 3).join(', ')}`,
    );
  }
  return { status: 'fail', reason: failures.join('; ') };
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function main() {
  let draft = false;
  let head = 'HEAD';
  if (process.env.GITHUB_EVENT_PATH) {
    try {
      const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
      if (event?.pull_request === undefined) {
        console.log('pass-binding: SKIPPED — not a pull request');
        return;
      }
      draft = event.pull_request?.draft === true;
      if (SHA_RE.test(event.pull_request?.head?.sha ?? '')) head = event.pull_request.head.sha;
    } catch {
      console.error('pass-binding: ✗ cannot read GitHub event');
      process.exit(1);
    }
  }
  let base;
  try {
    base = git('merge-base', 'origin/main', head).trim();
  } catch {
    console.log('pass-binding: SKIPPED — no origin/main merge-base');
    return;
  }
  const lines = (out) => out.trim().split('\n').filter(Boolean);
  const result = evaluateBinding({
    changed: lines(git('diff', '--name-only', base, head)),
    readHead: (path) => {
      try {
        return git('show', `${head}:${path}`);
      } catch {
        return null;
      }
    },
    isAncestor: (sha) => {
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', sha, head]);
        return true;
      } catch {
        return false;
      }
    },
    diffSince: (sha) => lines(git('diff', '--name-only', sha, head)),
    draft,
  });
  if (result.status === 'fail') {
    console.error(`pass-binding: ✗ ${result.reason}`);
    process.exit(1);
  }
  console.log(
    `pass-binding: ${result.status === 'ok' ? `OK (${result.artifact} @ ${result.sha.slice(0, 12)})` : `SKIPPED — ${result.reason}`}`,
  );
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
