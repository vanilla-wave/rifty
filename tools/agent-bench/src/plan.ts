import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Config } from './config.ts';
import type { Lane } from './lanes/types.ts';
import { killProcessGroup } from './proc.ts';
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
    split?: string;
    corpus?: string;
    corpusManifestSha256?: string;
    caseCardSha256?: string;
    controlsSha256?: Record<string, string>;
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
async function gitOutput(
  args: string[],
  consume: (chunk: string) => void,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let stderr = '';
    const timer = setTimeout(() => {
      void killProcessGroup(child);
      reject(new Error(`Git source command timed out: ${args.join(' ')}`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', consume);
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4096);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Git source command failed (${code ?? signal}): ${stderr}`));
    });
  });
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
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  let sourceDirty = false;
  await gitOutput(
    ['status', '--porcelain'],
    (chunk) => {
      sourceDirty ||= /\S/.test(chunk);
    },
    config.limits.runTimeoutMs,
  );
  const sourceDiff = createHash('sha256');
  await gitOutput(
    ['diff', 'HEAD', '--binary'],
    (chunk) => {
      sourceDiff.update(chunk);
    },
    config.limits.runTimeoutMs,
  );
  return {
    version: 1,
    sourceRevision,
    sourceDirty,
    sourceDiffSha256: sourceDiff.digest('hex'),
    config: structuredClone(config),
    order: 'task-lane-trial',
    tasks: await Promise.all(
      tasks.map(async (task) => ({
        id: task.id,
        group: task.group ?? 'smoke',
        family: task.family ?? (task.node ? 'hono-api' : 'trackline'),
        split: task.split,
        corpus: task.corpus,
        corpusManifestSha256: task.corpusManifestSha256,
        caseCardSha256: task.caseCardSha256,
        controlsSha256: task.controls
          ? Object.fromEntries(
              Object.entries(task.controls).map(([name, files]) => [
                name,
                digest(
                  JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
                ),
              ]),
            )
          : undefined,
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
