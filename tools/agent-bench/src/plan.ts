import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Config } from './config.ts';
import type { Lane } from './lanes/types.ts';
import type { Task } from './tasks.ts';

export interface Trial {
  task: string;
  lane: Lane;
  runIndex: number;
}
export interface Plan {
  version: 1;
  sourceRevision: string;
  sourceDirty: boolean;
  sourceDiffSha256: string;
  config: Config;
  order: 'task-lane-trial';
  tasks: {
    id: string;
    group: string;
    family: string;
    filesSha256: string;
    lockfileSha256: string | null;
    promptSha256: string;
    judgeSha256: string;
  }[];
  trials: Trial[];
}
export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
export async function resolvePlan(config: Config, tasks: Task[], lanes: Lane[]): Promise<Plan> {
  if (!tasks.length || !lanes.length || new Set(lanes).size !== lanes.length)
    throw new Error('Plan requires nonempty tasks and unique lanes');
  const ids = new Set<string>();
  for (const task of tasks) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(task.id) || ids.has(task.id))
      throw new Error(`Invalid or duplicate task identity: ${task.id}`);
    ids.add(task.id);
  }
  return {
    version: 1,
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceDirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
    sourceDiffSha256: digest(
      execFileSync('git', ['diff', 'HEAD', '--binary'], { encoding: 'utf8' }),
    ),
    config: structuredClone(config),
    order: 'task-lane-trial',
    tasks: await Promise.all(
      tasks.map(async (task) => ({
        id: task.id,
        group: task.group ?? 'smoke',
        family: task.family ?? (task.node ? 'hono-api' : 'trackline'),
        filesSha256: digest(
          JSON.stringify(Object.entries(task.files).sort(([a], [b]) => a.localeCompare(b))),
        ),
        lockfileSha256:
          task.files['package-lock.json'] === undefined
            ? null
            : digest(task.files['package-lock.json']),
        promptSha256: digest(task.prompt),
        judgeSha256: digest(
          (
            await Promise.all(
              (
                task.judgeFiles ?? [
                  `tools/agent-bench/tasks/${task.id}/judge.ts`,
                  'tools/agent-bench/src/judge/context.ts',
                ]
              ).map((path) => readFile(path, 'utf8')),
            )
          ).join('\n'),
        ),
      })),
    ),
    trials: tasks.flatMap((task) =>
      lanes.flatMap((lane) =>
        Array.from({ length: config.runsPerTask }, (_, index) => ({
          task: task.id,
          lane,
          runIndex: index + 1,
        })),
      ),
    ),
  };
}
