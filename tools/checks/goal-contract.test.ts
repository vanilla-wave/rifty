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
  evaluateMarkerHistory,
  goalContract,
  historyHeadRevision,
  inspectGoalBaseline,
  isContractOnlyBootstrap,
  parseGoalBaseline,
  recordedGoalBaseline,
} from './goal-contract.mjs';

const sha = '0123456789abcdef0123456789abcdef01234567';
const nextSha = '89abcdef0123456789abcdef0123456789abcdef';
const markerSha = 'abcdef0123456789abcdef0123456789abcdef01';
const childEnv = (overrides: NodeJS.ProcessEnv = {}) => ({
  ...process.env,
  GITHUB_EVENT_PATH: undefined,
  RIFTY_GOAL_BASELINE: undefined,
  ...overrides,
});
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

describe('goal-contract CLI history head', () => {
  it('validates marker commits on the PR head, not the synthetic merge first parent', () => {
    const root = mkdtempSync(join(tmpdir(), 'rifty-goal-pr-head-'));
    try {
      const epicDir = join(root, 'docs/backlog/epics');
      const epicPath = join(epicDir, 'goal.md');
      mkdirSync(epicDir, { recursive: true });
      writeFileSync(epicPath, epic());
      execFileSync('git', ['init', '-b', 'main'], { cwd: root });
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync(
        'git',
        ['-c', 'user.name=Rifty', '-c', 'user.email=rifty@example.test', 'commit', '-m', 'base'],
        { cwd: root },
      );
      const base = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim();
      execFileSync('git', ['update-ref', 'refs/remotes/origin/main', base], { cwd: root });

      execFileSync('git', ['switch', '-c', 'feature'], { cwd: root });
      writeFileSync(epicPath, epic().replace('Mutable run bookkeeping.', 'Refined bookkeeping.'));
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Rifty',
          '-c',
          'user.email=rifty@example.test',
          'commit',
          '-m',
          'contract',
        ],
        { cwd: root },
      );
      const contract = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim();
      writeFileSync(
        epicPath,
        withMarker(epic().replace('Mutable run bookkeeping.', 'Refined bookkeeping.'), contract),
      );
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync(
        'git',
        ['-c', 'user.name=Rifty', '-c', 'user.email=rifty@example.test', 'commit', '-m', 'marker'],
        { cwd: root },
      );
      const pullRequestHead = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim();

      execFileSync('git', ['switch', 'main'], { cwd: root });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Rifty',
          '-c',
          'user.email=rifty@example.test',
          'merge',
          '--no-ff',
          'feature',
          '-m',
          'synthetic merge',
        ],
        { cwd: root },
      );
      const eventPath = join(root, 'event.json');
      writeFileSync(
        eventPath,
        JSON.stringify({ pull_request: { body: '', head: { sha: pullRequestHead } } }),
      );

      const script = fileURLToPath(new URL('./goal-contract.mjs', import.meta.url));
      const env = childEnv({ GITHUB_EVENT_PATH: eventPath });
      expect(
        execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8', env }),
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
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync(
        'git',
        ['-c', 'user.name=Rifty', '-c', 'user.email=rifty@example.test', 'commit', '-m', 'base'],
        { cwd: root },
      );
      const base = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim();
      execFileSync('git', ['update-ref', 'refs/remotes/origin/main', base], { cwd: root });
      const eventPath = join(root, 'event.json');
      writeFileSync(
        eventPath,
        JSON.stringify({ pull_request: { body: '', head: { sha: nextSha } } }),
      );

      const script = fileURLToPath(new URL('./goal-contract.mjs', import.meta.url));
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

  it('rejects a later PR-body SHA that differs from the persistent epic marker', () => {
    const root = mkdtempSync(join(tmpdir(), 'rifty-goal-baseline-'));
    try {
      const epicDir = join(root, 'docs/backlog/epics');
      const sourceDir = join(root, 'packages/x/src');
      mkdirSync(epicDir, { recursive: true });
      mkdirSync(sourceDir, { recursive: true });
      const epicPath = join(epicDir, 'goal.md');
      writeFileSync(epicPath, epic());
      execFileSync('git', ['init', '-b', 'main'], { cwd: root });
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync(
        'git',
        ['-c', 'user.name=Rifty', '-c', 'user.email=rifty@example.test', 'commit', '-m', 'goal'],
        { cwd: root },
      );
      const baseline = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim();
      execFileSync('git', ['update-ref', 'refs/remotes/origin/main', baseline], { cwd: root });

      writeFileSync(
        epicPath,
        epic().replace('tier: robust', `tier: robust\ngoal_baseline: ${baseline}`),
      );
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync(
        'git',
        ['-c', 'user.name=Rifty', '-c', 'user.email=rifty@example.test', 'commit', '-m', 'marker'],
        { cwd: root },
      );
      const markerCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim();
      execFileSync('git', ['update-ref', 'refs/remotes/origin/main', markerCommit], {
        cwd: root,
      });
      writeFileSync(join(sourceDir, 'a.ts'), 'export const shipped = true;\n');
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync(
        'git',
        ['-c', 'user.name=Rifty', '-c', 'user.email=rifty@example.test', 'commit', '-m', 'source'],
        { cwd: root },
      );

      const script = fileURLToPath(new URL('./goal-contract.mjs', import.meta.url));
      const env = childEnv({ RIFTY_GOAL_BASELINE: `goal@${baseline}` });
      expect(
        execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8', env }),
      ).toContain('goal-contract: OK');
      const ratchet = spawnSync(process.execPath, [script], {
        cwd: root,
        encoding: 'utf8',
        env: childEnv({ RIFTY_GOAL_BASELINE: `goal@${markerCommit}` }),
      });
      expect(ratchet.status).toBe(1);
      expect(ratchet.stderr).toContain('keeps goal_baseline');

      const landedRun = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim();
      execFileSync('git', ['update-ref', 'refs/remotes/origin/main', landedRun], { cwd: root });
      writeFileSync(epicPath, withMarker(epic(), landedRun));
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync(
        'git',
        ['-c', 'user.name=Rifty', '-c', 'user.email=rifty@example.test', 'commit', '-m', 'tamper'],
        { cwd: root },
      );
      writeFileSync(epicPath, withMarker(epic(), baseline));
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync(
        'git',
        ['-c', 'user.name=Rifty', '-c', 'user.email=rifty@example.test', 'commit', '-m', 'restore'],
        { cwd: root },
      );
      const noGoalEnv = childEnv();
      const transientTamper = spawnSync(process.execPath, [script], {
        cwd: root,
        encoding: 'utf8',
        env: noGoalEnv,
      });
      expect(transientTamper.status).toBe(1);
      expect(transientTamper.stderr).toContain('active goal_baseline changed');
      const restored = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim();
      execFileSync('git', ['update-ref', 'refs/remotes/origin/main', restored], { cwd: root });

      const narrowed = withMarker(epic({ outcome: 'Only installation works.' }), baseline);
      writeFileSync(epicPath, narrowed);
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Rifty',
          '-c',
          'user.email=rifty@example.test',
          'commit',
          '-m',
          'narrow-before-pickup',
        ],
        { cwd: root },
      );
      const narrowedBaseline = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim();
      writeFileSync(
        epicPath,
        withMarker(epic({ outcome: 'Only installation works.' }), narrowedBaseline),
      );
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync(
        'git',
        ['-c', 'user.name=Rifty', '-c', 'user.email=rifty@example.test', 'commit', '-m', 'ratchet'],
        { cwd: root },
      );
      writeFileSync(join(sourceDir, 'b.ts'), 'export const more = true;\n');
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync(
        'git',
        ['-c', 'user.name=Rifty', '-c', 'user.email=rifty@example.test', 'commit', '-m', 'more'],
        { cwd: root },
      );
      const synchronousRatchet = spawnSync(process.execPath, [script], {
        cwd: root,
        encoding: 'utf8',
        env: childEnv({ RIFTY_GOAL_BASELINE: `goal@${narrowedBaseline}` }),
      });
      expect(synchronousRatchet.status).toBe(1);
      expect(synchronousRatchet.stderr).toContain('active goal_baseline changed');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('evaluateMarkerHistory', () => {
  const path = 'docs/backlog/epics/goal.md';

  it('allows one contract-only marker commit pointing to its ready parent', () => {
    expect(
      evaluateMarkerHistory(
        path,
        [
          { sha, text: epic() },
          { sha: markerSha, text: withMarker(epic(), sha) },
        ],
        false,
        null,
      ),
    ).toMatchObject({ canonical: sha, introduced: true, violations: [] });
  });

  it('requires marker establishment to land before a source PR', () => {
    expect(
      evaluateMarkerHistory(
        path,
        [
          { sha, text: epic() },
          { sha: markerSha, text: withMarker(epic(), sha) },
        ],
        true,
        { epicSlug: 'goal', sha },
      ).violations[0],
    ).toContain('contract-only PR');
  });

  it('rejects change, removal, and reappearance of an active marker', () => {
    const base = withMarker(epic(), sha);
    expect(
      evaluateMarkerHistory(
        path,
        [
          { sha: markerSha, text: base },
          { sha: nextSha, text: withMarker(epic(), nextSha) },
        ],
        true,
        { epicSlug: 'goal', sha: nextSha },
      ).violations[0],
    ).toContain('changed');
    expect(
      evaluateMarkerHistory(
        path,
        [
          { sha: markerSha, text: base },
          { sha: nextSha, text: epic() },
          { sha, text: base },
        ],
        false,
        null,
      ).violations,
    ).toEqual(expect.arrayContaining([expect.stringContaining('missing')]));
  });

  it('allows terminal deletion only with the matching declaration', () => {
    const states = [
      { sha: markerSha, text: withMarker(epic(), sha) },
      { sha: nextSha, text: null },
    ];
    expect(evaluateMarkerHistory(path, states, true, { epicSlug: 'goal', sha }).violations).toEqual(
      [],
    );
    expect(evaluateMarkerHistory(path, states, true, null).violations[0]).toContain(
      'matching Goal-Baseline',
    );
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
