import { describe, expect, it } from 'vitest';
import { overlaySeed } from '../seed.ts';
import { ALL_TASK_SLUGS, loadTask } from '../tasks.ts';
import { templateWorkspaceFiles } from '../templates.ts';
import {
  RIFTY_PROMPT_PROFILE,
  benchSeedFiles,
  mapAiStatusToOutcome,
  renderFinalDiff,
  renderTraceTerminal,
  riftyAiSettings,
  traceToLaneTrace,
} from './rifty.ts';

describe('mapAiStatusToOutcome', () => {
  it('maps every AiRunStatus to the run outcome', () => {
    expect(mapAiStatusToOutcome('done')).toBe('done');
    // error/aborted end the run; the judge + human classification handle them
    expect(mapAiStatusToOutcome('error')).toBe('done');
    expect(mapAiStatusToOutcome('aborted')).toBe('done');
    expect(mapAiStatusToOutcome('budget-exceeded')).toBe('budget-exceeded');
    expect(mapAiStatusToOutcome('idle')).toBeNull();
    expect(mapAiStatusToOutcome('running')).toBeNull();
  });

  it('throws loudly on an unknown status (playground drift must not pass silently)', () => {
    expect(() => mapAiStatusToOutcome('paused')).toThrow(/unknown AI run status 'paused'/);
  });
});

describe('traceToLaneTrace', () => {
  const artifacts = { trace: '/tmp/rifty-trace.json' };

  it('counts assistant transcript entries as turns and toolCalls verbatim', () => {
    const lane = traceToLaneTrace(
      {
        transcript: [
          { role: 'user' },
          { role: 'assistant' },
          { role: 'toolResult' },
          { role: 'assistant' },
        ],
        toolCalls: [{}, {}, {}],
        budget: { exceeded: false },
      },
      artifacts,
      null,
    );
    expect(lane.turns).toBe(2);
    expect(lane.toolCalls).toBe(3);
    expect(lane.agentExitCode).toBeNull();
    expect(lane.budgetReason).toBeNull();
    expect(lane.artifacts).toBe(artifacts);
  });

  it('prefers the harness budget reason over the trace one', () => {
    const lane = traceToLaneTrace(
      { budget: { exceeded: true, reason: 'budget-exceeded: max tool calls (50) reached' } },
      artifacts,
      "toolTimeoutMs (120000ms) exceeded by tool 'shell'",
    );
    expect(lane.budgetReason).toBe("toolTimeoutMs (120000ms) exceeded by tool 'shell'");
  });

  it('carries the session budget reason when the harness tripped nothing', () => {
    const lane = traceToLaneTrace(
      { budget: { exceeded: true, reason: 'budget-exceeded: run time limit (600000ms) reached' } },
      artifacts,
      null,
    );
    expect(lane.budgetReason).toBe('budget-exceeded: run time limit (600000ms) reached');
  });
});

describe('renderTraceTerminal', () => {
  it('formats agent shell runs as command/output/exit blocks', () => {
    const text = renderTraceTerminal({
      terminal: [
        { command: 'node -e "console.log(1)"', exitCode: 0, output: '1' },
        { command: 'npm test', exitCode: 1, output: 'FAIL' },
      ],
    });
    expect(text).toContain('$ node -e "console.log(1)"');
    expect(text).toContain('(exit 0)');
    expect(text).toContain('FAIL');
    expect(text).toContain('(exit 1)');
  });

  it('says so when the agent ran no shell commands', () => {
    expect(renderTraceTerminal({})).toContain('no agent shell runs');
  });
});

describe('renderFinalDiff', () => {
  it('renders DiffEntry[] as unified-diff-shaped text', () => {
    const text = renderFinalDiff([
      {
        filepath: 'src/App.tsx',
        change: 'modify',
        hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [' a', '+b'] }],
      },
      { filepath: 'logo.png', change: 'add', binary: true },
    ]);
    expect(text).toContain('diff --rifty a/src/App.tsx b/src/App.tsx (modify)');
    expect(text).toContain('@@ -1,1 +1,2 @@');
    expect(text).toContain('+b');
    expect(text).toContain('Binary files a/logo.png and b/logo.png differ');
  });

  it('empty diff renders empty (same as the local lane)', () => {
    expect(renderFinalDiff([])).toBe('');
  });

  it('surfaces the gitDiff error shape loudly', () => {
    expect(renderFinalDiff({ error: 'workspace owner is not running' })).toContain(
      'git diff unavailable: workspace owner is not running',
    );
  });

  it('never hides an unrecognized shape', () => {
    expect(renderFinalDiff(42)).toContain('unrecognized finalDiff shape: 42');
  });
});

describe('riftyAiSettings', () => {
  it('produces the rf.ai.v1 AiSettings shape from config (toolTimeoutMs stays harness-side)', () => {
    const settings = riftyAiSettings(
      { baseUrl: 'http://127.0.0.1:9/v1', model: 'm', envKey: 'K' },
      { maxToolCalls: 7, runTimeoutMs: 1000, toolTimeoutMs: 500 },
      'secret-key',
    );
    expect(settings).toEqual({
      baseUrl: 'http://127.0.0.1:9/v1',
      apiKey: 'secret-key',
      model: 'm',
      maxToolCalls: 7,
      runTimeoutMs: 1000,
    });
    expect('toolTimeoutMs' in settings).toBe(false); // no in-session knob (ai/settings.ts)
  });
});

describe('rifty seed parity', () => {
  it('seeding benchSeedFiles over the booted preset equals the local lane tree', () => {
    for (const slug of ALL_TASK_SLUGS) {
      const task = loadTask(slug);
      const template = templateWorkspaceFiles(task.templateId);
      // local lane materializes overlaySeed(template, task.seed); the rifty
      // lane boots the preset (== template) and seeds benchSeedFiles on top.
      expect(overlaySeed(template, benchSeedFiles(task)), slug).toEqual(
        overlaySeed(template, task.seed),
      );
      // seed paths are workspace-relative (the shape __riftyAgentBench.seed takes)
      for (const rel of Object.keys(benchSeedFiles(task))) {
        expect(rel.startsWith('/'), `${slug}: ${rel}`).toBe(false);
      }
    }
  });
});

describe('profiles', () => {
  it('pins the ADR-0190 profile name', () => {
    expect(RIFTY_PROMPT_PROFILE).toBe('pi-baseline+rifty-adapter-v1');
  });
});
