import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  closureIdentityViolations,
  declaredGoals,
  evaluateGoal,
  evaluateMarkerTransition,
  goalContract,
  historyHeadRevision,
  inspectGoalBaseline,
  isContractOnlyBootstrap,
  parseGoalBaseline,
  recordedGoalBaseline,
} from './goal-contract.mjs';

const sha = '0123456789abcdef0123456789abcdef01234567';
const nextSha = '89abcdef0123456789abcdef0123456789abcdef';
const childEnv = (overrides: NodeJS.ProcessEnv = {}) => ({
  ...process.env,
  GITHUB_EVENT_PATH: undefined,
  RIFTY_GOAL_BASELINE: undefined,
  ...overrides,
});
const script = fileURLToPath(new URL('./goal-contract.mjs', import.meta.url));
const commit = (cwd: string, message: string) => {
  execFileSync('git', ['add', '-A'], { cwd });
  execFileSync(
    'git',
    ['-c', 'user.name=Rifty', '-c', 'user.email=rifty@example.test', 'commit', '-m', message],
    { cwd },
  );
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
};
const setOriginMain = (cwd: string, revision: string) =>
  execFileSync('git', ['update-ref', 'refs/remotes/origin/main', revision], { cwd });
const epic = ({
  value = 'A real package runs',
  tier = 'robust',
  outcome = 'The package installs and runs through one honest path.',
  scenario = 'Open the project, install, run, reload offline.',
  invariants = 'Install survives an offline reload.',
} = {}) => `---
kind: epic
status: ready
title: Goal
created: 2026-07-25
value: ${value}
user_story: As a developer, I want the package to run.
tier: ${tier}
---

## Outcome

${outcome}

## User scenario

${scenario}

## Invariants

- I1. ${invariants}

## Items

1. \`playground/a\` — first mechanism.

## Budget

Mutable run bookkeeping.
`;
const withMarker = (text: string, marker: string) =>
  text.replace('tier: robust', `tier: robust\ngoal_baseline: ${marker}`);

describe('declaredGoals / parseGoalBaseline', () => {
  it('prefers the task-scoped env and reads every PR-body declaration', () => {
    expect(declaredGoals({ RIFTY_GOAL_BASELINE: ` goal@${sha} ` }, () => '')).toEqual([
      `goal@${sha}`,
    ]);
    const event = JSON.stringify({
      pull_request: { body: `Goal-Baseline: first@${sha}\nGoal-Baseline: second@${sha}\n` },
    });
    expect(declaredGoals({ GITHUB_EVENT_PATH: '/tmp/event.json' }, () => event)).toEqual([
      `first@${sha}`,
      `second@${sha}`,
    ]);
    expect(declaredGoals({}, () => '')).toEqual([]);
  });

  it('requires an epic slug and an exact commit hash', () => {
    expect(parseGoalBaseline(`honest-shadow-substitutions@${sha}`)).toEqual({
      epicSlug: 'honest-shadow-substitutions',
      sha,
    });
    expect(parseGoalBaseline('honest-shadow-substitutions@abc123')).toBeNull();
    expect(parseGoalBaseline(`epics/honest@${sha}`)).toBeNull();
  });

  it('selects an exact PR head and rejects a malformed PR event identity', () => {
    const event = (head: unknown) => JSON.stringify({ pull_request: { head: { sha: head } } });
    expect(historyHeadRevision({}, () => '')).toEqual({
      revision: 'HEAD',
      kind: 'checkout',
      error: null,
    });
    expect(historyHeadRevision({ GITHUB_EVENT_PATH: '/tmp/event.json' }, () => event(sha))).toEqual(
      { revision: sha, kind: 'pull-request', error: null },
    );
    expect(
      historyHeadRevision({ GITHUB_EVENT_PATH: '/tmp/event.json' }, () => event('abc123')).error,
    ).toContain('exact 40-hex');
  });

  it('uses checkout history for push/merge-group events and rejects unreadable events', () => {
    for (const event of [{ ref: 'refs/heads/main' }, { merge_group: { head_sha: sha } }]) {
      expect(
        historyHeadRevision({ GITHUB_EVENT_PATH: '/tmp/event.json' }, () => JSON.stringify(event)),
      ).toEqual({ revision: 'HEAD', kind: 'checkout', error: null });
    }
    expect(
      historyHeadRevision({ GITHUB_EVENT_PATH: '/tmp/event.json' }, () => '{').error,
    ).toContain('cannot read');
  });
});

describe('goalContract / evaluateGoal', () => {
  it('freezes only observable goal fields, not status, Items, or Budget', () => {
    const baseline = epic();
    const current = epic()
      .replace('status: ready', 'status: in-progress')
      .replace(
        '1. `playground/a` — first mechanism.',
        '1. `playground/b` — new mechanism.\n2. `playground/a` — reordered.',
      )
      .replace('Mutable run bookkeeping.', 'Re-cut run bookkeeping.');

    expect(goalContract(baseline)).toEqual({
      value: 'A real package runs',
      tier: 'robust',
      outcome: 'The package installs and runs through one honest path.',
      userScenario: 'Open the project, install, run, reload offline.',
      invariants: '- I1. Install survives an offline reload.',
    });
    expect(evaluateGoal(baseline, current, [])).toEqual([]);
  });

  it('freezes every line of observable goal sections', () => {
    const baseline = epic({
      outcome: 'First outcome.\nSecond outcome.',
      scenario: 'First action.\nSecond action.',
      invariants: 'First invariant.\n- I2. Second invariant.',
    });
    const current = baseline
      .replace('Second outcome.', 'Narrowed outcome.')
      .replace('Second action.', 'Narrowed action.')
      .replace('Second invariant.', 'Narrowed invariant.');

    expect(evaluateGoal(baseline, current, [])).toEqual([
      'frozen Outcome changed from baseline',
      'frozen User scenario changed from baseline',
      'frozen Invariants changed from baseline',
    ]);
  });

  it('rejects a baseline lacking Invariants', () => {
    const stripped = epic().replace(/## Invariants[\s\S]*?## Items/, '## Items');
    expect(evaluateGoal(stripped, epic(), [])[0]).toContain('Invariants');
  });

  it.each([
    ['value', epic({ value: 'A smaller promise' })],
    ['tier', epic({ tier: 'works' })],
    ['Outcome', epic({ outcome: 'Only installation works.' })],
    ['User scenario', epic({ scenario: 'Open the project once.' })],
    ['Invariants', epic({ invariants: 'Install works once.' })],
  ])('blocks drift in frozen %s', (field, current) => {
    expect(evaluateGoal(epic(), current, [])[0]).toContain(field);
  });

  it('requires a ready baseline and rejects demotion to draft', () => {
    expect(evaluateGoal(epic().replace('status: ready', 'status: draft'), epic(), [])[0]).toContain(
      'baseline',
    );
    expect(evaluateGoal(epic(), epic().replace('status: ready', 'status: draft'), [])[0]).toContain(
      'draft',
    );
  });

  it('requires a quality tier and reads the persistent cross-PR marker', () => {
    expect(evaluateGoal(epic().replace('tier: robust\n', ''), epic(), [])[0]).toContain('tier');
    expect(recordedGoalBaseline(withMarker(epic(), sha))).toBe(sha);
    expect(recordedGoalBaseline(epic())).toBeNull();
    expect(inspectGoalBaseline(withMarker(withMarker(epic(), sha), nextSha)).error).toContain(
      'want one',
    );
  });

  it('allows delete-on-done only when no reverse-linked goal residual remains', () => {
    expect(evaluateGoal(epic(), null, [])).toEqual([]);
    expect(evaluateGoal(epic(), null, ['playground/a'])).toEqual([
      'goal epic deleted with open residual items: playground/a',
    ]);
  });
});

describe('evaluateMarkerTransition', () => {
  const path = 'docs/backlog/epics/goal.md';
  const opts = (overrides = {}) => ({ contractOnlyPR: true, declaredGoal: null, ...overrides });

  it('ignores an epic without a marker on either side', () => {
    expect(evaluateMarkerTransition(path, epic(), epic({ tier: 'works' }), opts())).toEqual({
      canonical: null,
      deleted: false,
      introduced: false,
      violations: [],
    });
  });

  it('reports marker parse errors on either side', () => {
    expect(
      evaluateMarkerTransition(path, withMarker(withMarker(epic(), sha), nextSha), epic(), opts())
        .violations[0],
    ).toContain('merge-base want one goal_baseline');
    expect(
      evaluateMarkerTransition(path, epic(), withMarker(epic(), 'abc123'), opts()).violations[0],
    ).toContain('exact 40-hex');
  });

  it('allows bookkeeping edits and blocks frozen drift or demotion in an active run', () => {
    const base = withMarker(epic(), sha);
    expect(
      evaluateMarkerTransition(
        path,
        base,
        withMarker(epic().replace('Mutable run bookkeeping.', 'Re-cut.'), sha),
        opts({ contractOnlyPR: false }),
      ),
    ).toEqual({ canonical: sha, deleted: false, introduced: false, violations: [] });
    expect(
      evaluateMarkerTransition(
        path,
        base,
        withMarker(epic({ outcome: 'Only installation works.' }), sha),
        opts(),
      ).violations,
    ).toEqual([`${path}: frozen Outcome changed from baseline`]);
    expect(
      evaluateMarkerTransition(
        path,
        base,
        withMarker(epic().replace('status: ready', 'status: draft'), sha),
        opts(),
      ).violations[0],
    ).toContain('demoted to draft');
  });

  it('rejects change and removal of an active marker', () => {
    const base = withMarker(epic(), sha);
    expect(
      evaluateMarkerTransition(path, base, withMarker(epic(), nextSha), opts()).violations,
    ).toEqual([`${path}: active goal_baseline changed from ${sha} to ${nextSha}`]);
    expect(evaluateMarkerTransition(path, base, epic(), opts()).violations).toEqual([
      `${path}: goal_baseline removed while the run is active`,
    ]);
  });

  it('allows terminal deletion only with the matching declaration', () => {
    const base = withMarker(epic(), sha);
    expect(
      evaluateMarkerTransition(path, base, null, opts({ declaredGoal: { epicSlug: 'goal', sha } })),
    ).toMatchObject({ canonical: sha, deleted: true, violations: [] });
    expect(evaluateMarkerTransition(path, base, null, opts()).violations[0]).toContain(
      'matching Goal-Baseline',
    );
    expect(
      evaluateMarkerTransition(
        path,
        base,
        null,
        opts({ declaredGoal: { epicSlug: 'goal', sha: nextSha } }),
      ).violations[0],
    ).toContain('matching Goal-Baseline');
  });

  it('allows a contract-only bootstrap of a ready, complete epic', () => {
    for (const base of [epic(), null]) {
      expect(evaluateMarkerTransition(path, base, withMarker(epic(), sha), opts())).toEqual({
        canonical: sha,
        deleted: false,
        introduced: true,
        violations: [],
      });
    }
  });

  it('requires marker establishment to land before a source PR', () => {
    expect(
      evaluateMarkerTransition(
        path,
        epic(),
        withMarker(epic(), sha),
        opts({ contractOnlyPR: false }),
      ).violations[0],
    ).toContain('contract-only PR');
  });

  it('rejects bootstrap on a non-ready or incomplete epic', () => {
    expect(
      evaluateMarkerTransition(
        path,
        null,
        withMarker(epic().replace('status: ready', 'status: draft'), sha),
        opts(),
      ).violations,
    ).toEqual([`${path}: goal_baseline epic lacks the complete observable contract`]);
    expect(
      evaluateMarkerTransition(
        path,
        null,
        withMarker(epic(), sha).replace(/## Invariants[\s\S]*?## Items/, '## Items'),
        opts(),
      ).violations[0],
    ).toContain('complete observable contract');
  });

  it('rejects closure coupled to an epic rename or replacement', () => {
    const histories = new Map([
      [
        'docs/backlog/epics/goal.md',
        { canonical: sha, deleted: true, introduced: false, violations: [] },
      ],
      [
        'docs/backlog/epics/new-goal.md',
        { canonical: null, deleted: false, introduced: false, violations: [] },
      ],
    ]);
    expect(closureIdentityViolations(histories)[0]).toContain('another epic identity');
  });

  it('treats every non-docs artifact as implementation in a bootstrap PR', () => {
    expect(isContractOnlyBootstrap(['docs/backlog/epics/goal.md'])).toBe(true);
    expect(
      isContractOnlyBootstrap([
        'docs/backlog/epics/goal.md',
        'docs/adr/net/0301-example.md',
        'docs/process/decision-workflow.md',
      ]),
    ).toBe(true);
    for (const path of [
      'apps/playground/src/theme.css',
      'packages/x/package.json',
      'tools/build.mjs',
      'examples/demo/index.html',
      'docs/public/compat/index.html',
    ]) {
      expect(isContractOnlyBootstrap(['docs/backlog/epics/goal.md', path])).toBe(false);
    }
  });
});

describe('goal-contract CLI', () => {
  it('reads head content from the exact PR head, not the checked-out worktree', () => {
    const root = mkdtempSync(join(tmpdir(), 'rifty-goal-pr-head-'));
    try {
      const epicPath = join(root, 'docs/backlog/epics/goal.md');
      mkdirSync(join(root, 'docs/backlog/epics'), { recursive: true });
      writeFileSync(epicPath, epic());
      execFileSync('git', ['init', '-b', 'main'], { cwd: root });
      const base = commit(root, 'base');
      setOriginMain(root, base);

      execFileSync('git', ['switch', '-c', 'feature'], { cwd: root });
      writeFileSync(epicPath, withMarker(epic(), sha));
      const pullRequestHead = commit(root, 'marker');
      execFileSync('git', ['switch', 'main'], { cwd: root });

      const eventPath = join(root, 'event.json');
      writeFileSync(
        eventPath,
        JSON.stringify({ pull_request: { body: '', head: { sha: pullRequestHead } } }),
      );
      expect(
        execFileSync(process.execPath, [script], {
          cwd: root,
          encoding: 'utf8',
          env: childEnv({ GITHUB_EVENT_PATH: eventPath }),
        }),
      ).toContain('1 marker(s) established');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when the exact PR head commit is unavailable', () => {
    const root = mkdtempSync(join(tmpdir(), 'rifty-goal-missing-pr-head-'));
    try {
      writeFileSync(join(root, 'README.md'), 'fixture\n');
      execFileSync('git', ['init', '-b', 'main'], { cwd: root });
      const base = commit(root, 'base');
      setOriginMain(root, base);
      const eventPath = join(root, 'event.json');
      writeFileSync(
        eventPath,
        JSON.stringify({ pull_request: { body: '', head: { sha: nextSha } } }),
      );

      const result = spawnSync(process.execPath, [script], {
        cwd: root,
        encoding: 'utf8',
        env: childEnv({ GITHUB_EVENT_PATH: eventPath }),
      });
      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain('SKIPPED');
      expect(result.stderr).toContain('no origin/main merge-base for pull-request history');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('anchors the declared run to merge-base vs head content, not commit topology', () => {
    const root = mkdtempSync(join(tmpdir(), 'rifty-goal-baseline-'));
    try {
      const epicPath = join(root, 'docs/backlog/epics/goal.md');
      const sourceDir = join(root, 'packages/x/src');
      mkdirSync(join(root, 'docs/backlog/epics'), { recursive: true });
      mkdirSync(sourceDir, { recursive: true });
      writeFileSync(epicPath, epic());
      execFileSync('git', ['init', '-b', 'main'], { cwd: root });
      const baseline = commit(root, 'goal');
      setOriginMain(root, baseline);

      writeFileSync(epicPath, withMarker(epic(), baseline));
      const markerCommit = commit(root, 'marker');
      setOriginMain(root, markerCommit);
      writeFileSync(join(sourceDir, 'a.ts'), 'export const shipped = true;\n');
      commit(root, 'source');

      expect(
        execFileSync(process.execPath, [script], {
          cwd: root,
          encoding: 'utf8',
          env: childEnv({ RIFTY_GOAL_BASELINE: `goal@${baseline}` }),
        }),
      ).toContain('goal-contract: OK');
      const ratchet = spawnSync(process.execPath, [script], {
        cwd: root,
        encoding: 'utf8',
        env: childEnv({ RIFTY_GOAL_BASELINE: `goal@${markerCommit}` }),
      });
      expect(ratchet.status).toBe(1);
      expect(ratchet.stderr).toContain('keeps goal_baseline');

      writeFileSync(epicPath, withMarker(epic(), nextSha));
      commit(root, 'tamper');
      writeFileSync(epicPath, withMarker(epic(), baseline));
      commit(root, 'restore');
      expect(
        execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8', env: childEnv() }),
      ).toContain('no autonomous goal declared');

      writeFileSync(epicPath, withMarker(epic(), nextSha));
      commit(root, 'retamper');
      const changed = spawnSync(process.execPath, [script], {
        cwd: root,
        encoding: 'utf8',
        env: childEnv(),
      });
      expect(changed.status).toBe(1);
      expect(changed.stderr).toContain('active goal_baseline changed');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('allows closure only after every reverse-linked residual is gone', () => {
    const root = mkdtempSync(join(tmpdir(), 'rifty-goal-closure-'));
    try {
      const epicPath = join(root, 'docs/backlog/epics/goal.md');
      const itemPath = join(root, 'docs/backlog/playground/a.md');
      mkdirSync(join(root, 'docs/backlog/epics'), { recursive: true });
      mkdirSync(join(root, 'docs/backlog/playground'), { recursive: true });
      writeFileSync(epicPath, withMarker(epic(), sha));
      writeFileSync(itemPath, '---\nkind: item\nstatus: ready\nepic: goal\n---\n\nChild.\n');
      execFileSync('git', ['init', '-b', 'main'], { cwd: root });
      const base = commit(root, 'base');
      setOriginMain(root, base);

      rmSync(epicPath);
      commit(root, 'close epic');
      const residual = spawnSync(process.execPath, [script], {
        cwd: root,
        encoding: 'utf8',
        env: childEnv({ RIFTY_GOAL_BASELINE: `goal@${sha}` }),
      });
      expect(residual.status).toBe(1);
      expect(residual.stderr).toContain('open residual items: playground/a');

      rmSync(itemPath);
      commit(root, 'close item');
      expect(
        execFileSync(process.execPath, [script], {
          cwd: root,
          encoding: 'utf8',
          env: childEnv({ RIFTY_GOAL_BASELINE: `goal@${sha}` }),
        }),
      ).toContain('closure candidate');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
