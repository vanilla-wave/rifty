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
  inspectGoalBaseline,
  isContractOnlyBootstrap,
  parseGoalBaseline,
  recordedGoalBaseline,
} from './goal-contract.mjs';

const sha = '0123456789abcdef0123456789abcdef01234567';
const nextSha = '89abcdef0123456789abcdef0123456789abcdef';
const markerSha = 'abcdef0123456789abcdef0123456789abcdef01';
const epic = ({
  value = 'A real package runs',
  tier = 'robust',
  outcome = 'The package installs and runs through one honest path.',
  scenario = 'Open the project, install, run, reload offline.',
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
    });
    expect(evaluateGoal(baseline, current, [])).toEqual([]);
  });

  it.each([
    ['value', epic({ value: 'A smaller promise' })],
    ['tier', epic({ tier: 'works' })],
    ['Outcome', epic({ outcome: 'Only installation works.' })],
    ['User scenario', epic({ scenario: 'Open the project once.' })],
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
      const env = { ...process.env, RIFTY_GOAL_BASELINE: `goal@${baseline}` };
      expect(
        execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8', env }),
      ).toContain('goal-contract: OK');
      const ratchet = spawnSync(process.execPath, [script], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, RIFTY_GOAL_BASELINE: `goal@${markerCommit}` },
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
      const noGoalEnv = { ...process.env };
      noGoalEnv.RIFTY_GOAL_BASELINE = undefined;
      noGoalEnv.GITHUB_EVENT_PATH = undefined;
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
        env: { ...process.env, RIFTY_GOAL_BASELINE: `goal@${narrowedBaseline}` },
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

  it('treats every non-backlog artifact as implementation in a bootstrap PR', () => {
    expect(isContractOnlyBootstrap(['docs/backlog/epics/goal.md'])).toBe(true);
    for (const path of [
      'apps/playground/src/theme.css',
      'packages/x/package.json',
      'tools/build.mjs',
      'examples/demo/index.html',
    ]) {
      expect(isContractOnlyBootstrap(['docs/backlog/epics/goal.md', path])).toBe(false);
    }
  });
});
