import { type ChildProcess, spawn } from 'node:child_process';
import { emptyMetrics } from '../metrics.ts';
import { decodeProcessOutput } from '../proc.ts';
import type { Input, Observation } from './types.ts';

export const codexIsolation = {
  ephemeral: true,
  ignoreUserConfig: true,
  ignoreRules: true,
  projectDocMaxBytes: 0,
} as const;
export async function runCodex(
  input: Input,
  workspace: string,
  env: NodeJS.ProcessEnv,
  register: (child: ChildProcess) => void,
  stop: () => void,
): Promise<Observation> {
  const config = input.config.codex;
  if (!config) throw new Error('native-codex requires explicit config.codex');
  const args = [
    'exec',
    '--ignore-user-config',
    '--ignore-rules',
    '--ephemeral',
    '--json',
    '--approve-for-me',
    '-C',
    workspace,
    '-m',
    config.model,
    '-c',
    `model_reasoning_effort=${JSON.stringify(config.reasoning)}`,
    '-c',
    'project_doc_max_bytes=0',
    input.task.prompt,
  ];
  const child = spawn('codex', args, {
    cwd: workspace,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  register(child);
  decodeProcessOutput(child);
  let stdout = '';
  let stderr = '';
  let cursor = 0;
  let budget: 'maxToolCalls' | 'runTimeoutMs' | undefined;
  const observed: Record<string, unknown>[] = [];
  const exhaust = (kind: 'maxToolCalls' | 'runTimeoutMs') => {
    if (!budget) {
      budget = kind;
      stop();
    }
  };
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
    const end = stdout.lastIndexOf('\n') + 1;
    for (const line of stdout.slice(cursor, end).split('\n').filter(Boolean)) {
      try {
        const event = object(JSON.parse(line) as unknown);
        if (event) observed.push(event);
      } catch {
        /* terminal observation retains the malformed stream */
      }
    }
    cursor = end;
    if (codexToolIds(observed).size > input.config.limits.maxToolCalls) exhaust('maxToolCalls');
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const timer = setTimeout(() => exhaust('runTimeoutMs'), input.config.limits.runTimeoutMs);
  if (input.signal?.aborted) stop();
  try {
    const code = await new Promise<number | null>((done, reject) => {
      child.once('error', reject);
      child.once('close', done);
    });
    const observation = codexObservation(stdout, stderr, code, budget);
    observation.trace = {
      ...object(observation.trace),
      command: ['codex', ...args],
      isolation: codexIsolation,
      sandbox: 'workspace-write',
      approval: 'automatic review',
      budgetAdmission: 'observed item events; may overshoot; reported counts not truncated',
    };
    return observation;
  } finally {
    clearTimeout(timer);
  }
}

const tools = new Set(['command_execution', 'file_change', 'mcp_tool_call', 'web_search']);
function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
export function codexToolIds(events: readonly Record<string, unknown>[]): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    const item = object(event.item);
    if (item && tools.has(String(item.type)) && typeof item.id === 'string') ids.add(item.id);
  }
  return ids;
}

/** Interpret the pinned CLI's actual terminal protocol; retain malformed streams too. */
export function codexObservation(
  stdout: string,
  stderr: string,
  exitCode: number | null,
  budget?: 'maxToolCalls' | 'runTimeoutMs',
): Observation {
  const events: Record<string, unknown>[] = [];
  let error: string | undefined;
  for (const line of stdout.split('\n').filter((line) => line.trim())) {
    try {
      const event = object(JSON.parse(line) as unknown);
      if (!event || typeof event.type !== 'string') throw new Error('Event requires type');
      events.push(event);
    } catch (cause) {
      error = `Invalid Codex JSONL: ${String(cause)}`;
    }
  }
  const completed = events.filter((event) => event.type === 'turn.completed');
  const failed = events.some((event) => ['turn.failed', 'error'].includes(String(event.type)));
  const usage = object(completed[0]?.usage);
  const tokens = (key: string) => {
    const value = usage?.[key];
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? value
      : undefined;
  };
  const input = tokens('input_tokens');
  const output = tokens('output_tokens');
  if (
    completed.length !== 1 ||
    failed ||
    exitCode !== 0 ||
    input === undefined ||
    output === undefined
  )
    error ??= `Codex incomplete/failed terminal protocol (exit ${exitCode}, completed ${completed.length}, failed ${failed})`;
  const unavailableMetrics: NonNullable<Observation['unavailableMetrics']> = [
    'retries',
    'compactions',
    'repeatedCallNotices',
    'editFailures',
    'malformedToolCalls',
  ];
  if (input === undefined) unavailableMetrics.push('inputTokens');
  if (output === undefined) unavailableMetrics.push('outputTokens');
  const terminal = events.flatMap((event) => {
    const item = object(event.item);
    return typeof item?.aggregated_output === 'string' ? [item.aggregated_output] : [];
  });
  return {
    ...emptyMetrics(),
    inputTokens: input ?? 0,
    outputTokens: output ?? 0,
    unavailableMetrics,
    agentStatus: budget ? 'budget-exceeded' : error ? 'error' : 'done',
    turns: completed.length,
    toolCalls: codexToolIds(events).size,
    usage: usage ?? null,
    trace: {
      events,
      stdout,
      stderr,
      exitCode,
      budget: budget ?? null,
      protocolError: error ?? null,
    },
    terminalTail: [...terminal, stderr, error ?? ''].filter(Boolean).join('\n').slice(-16000),
    ...(error === undefined ? {} : { error }),
  };
}
