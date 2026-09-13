import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { chromium } from '@playwright/test';
import { getAgentPromptProfile } from '@riftydev/agent';
import { type Config, readKey, redact, taskSet } from './config.ts';
import { diffTrees } from './files.ts';
import { prepareLocal } from './lanes/local-reference.ts';
import { prepareNoCoi } from './lanes/rifty-no-coi.ts';
import { prepareRifty } from './lanes/rifty.ts';
import type { Lane, Prepared } from './lanes/types.ts';
import { type Report, type Run, caveat, writeReport } from './report.ts';
import { services } from './services.ts';
import type { Task } from './tasks.ts';
export async function run(config: Config, tasks: Task[], lanes: Lane[], output: string) {
  if (!config.endpoint) throw new Error('Endpoint required: --config or --mock-model');
  const endpoint = config.endpoint;
  const key = readKey(endpoint);
  const profile = getAgentPromptProfile().id;
  await mkdir(output, { recursive: true });
  const report: Report = {
    header: {
      createdAt: new Date().toISOString(),
      sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      sourceDirty:
        execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
      versions: {
        node: process.version,
        piCli: (
          JSON.parse(
            await readFile(
              'tools/agent-bench/node_modules/@earendil-works/pi-coding-agent/package.json',
              'utf8',
            ),
          ) as { version: string }
        ).version,
      },
      model: endpoint.model,
      profile,
      taskSet,
      endpoint,
      limits: config.limits,
      runsPerTask: config.runsPerTask,
      toolContextCaveat: caveat,
      unsupported: ['rifty-no-coi/node-endpoint: installed-bin resident preview only'],
    },
    runs: [],
  };
  const hosts = await services(lanes, config.playgroundPort, output);
  const browser = await chromium.launch();
  report.header.versions.chromium = browser.version();
  const persist = () =>
    writeReport(output, JSON.parse(redact(JSON.stringify(report), key)) as Report);
  try {
    for (const task of tasks)
      for (const lane of lanes) {
        if (task.node && lane === 'rifty-no-coi') continue;
        for (let index = 1; index <= config.runsPerTask; index++) {
          const name = `${task.id}/${lane}/${index}`;
          const dir = join(output, name);
          await mkdir(dir, { recursive: true });
          console.log(`START ${name}`);
          const record: Run = {
            task: task.id,
            lane,
            runIndex: index,
            profile,
            agentStatus: 'error',
            outcome: 'fail',
            elapsedMs: 0,
            turns: 0,
            toolCalls: 0,
            usage: null,
            terminalTail: '',
            judge: { pass: false, probes: [] },
            finalDiff: [],
            artifacts: { trace: `${name}/trace.json` },
            failureClass: null,
            note: null,
            stage: 'setup',
          };
          let prepared: Prepared | undefined;
          let tracing = false;
          let started = Date.now();
          try {
            const input = { browser, task, config, endpoint, key, dir, ...hosts };
            prepared = await (lane === 'rifty'
              ? prepareRifty(input)
              : lane === 'rifty-no-coi'
                ? prepareNoCoi(input)
                : prepareLocal(input));
            await writeFile(
              join(dir, 'before.json'),
              redact(JSON.stringify(prepared.before, null, 2), key),
            );
            record.artifacts.before = `${name}/before.json`;
            if (prepared.workspace)
              record.artifacts.workspace = relative(output, prepared.workspace);
            if (!key) {
              await prepared.context.tracing.start({
                screenshots: true,
                snapshots: false,
                sources: false,
              });
              tracing = true;
            }
            record.stage = 'agent';
            started = Date.now();
            const observation = await prepared.run();
            record.elapsedMs = Date.now() - started;
            const { trace, ...metrics } = observation;
            Object.assign(record, metrics);
            await writeFile(join(dir, 'trace.json'), redact(JSON.stringify(trace, null, 2), key));
            record.stage = 'judge';
            try {
              if (tracing) await prepared.context.tracing.group(`judge:${task.id}`);
              record.judge = await task.judge(await prepared.preview());
              if (!key) {
                await prepared.page.screenshot({ path: join(dir, 'screen.png') });
                record.artifacts.screen = `${name}/screen.png`;
              }
            } finally {
              if (tracing) await prepared.context.tracing.groupEnd();
            }
            record.stage = 'snapshot';
            const after = await prepared.snapshot();
            await writeFile(join(dir, 'after.json'), redact(JSON.stringify(after, null, 2), key));
            record.artifacts.after = `${name}/after.json`;
            record.finalDiff = diffTrees(prepared.before, after);
            record.outcome =
              record.agentStatus === 'budget-exceeded'
                ? 'budget-exceeded'
                : record.agentStatus === 'done' && record.judge.pass
                  ? 'pass'
                  : 'fail';
            record.stage = undefined;
          } catch (error) {
            record.error = redact(
              error instanceof Error ? (error.stack ?? error.message) : String(error),
              key,
            );
            record.elapsedMs ||= Date.now() - started;
            if (record.agentStatus === 'budget-exceeded') record.outcome = 'budget-exceeded';
            if (prepared)
              try {
                const after = await prepared.snapshot();
                await writeFile(
                  join(dir, 'after.json'),
                  redact(JSON.stringify(after, null, 2), key),
                );
                record.artifacts.after = `${name}/after.json`;
                record.finalDiff = diffTrees(prepared.before, after);
              } catch (snapshotError) {
                record.error += `\nSnapshot failed: ${redact(String(snapshotError), key)}`;
              }
            await writeFile(
              join(dir, 'failure.json'),
              JSON.stringify({ stage: record.stage, error: record.error }, null, 2),
            );
            if (record.stage === 'setup' || record.stage === 'agent')
              await writeFile(
                join(dir, 'trace.json'),
                JSON.stringify({ stage: record.stage, error: record.error }, null, 2),
              );
          } finally {
            if (tracing && prepared) {
              await prepared.context.tracing.stop({ path: join(dir, 'browser.zip') });
              record.artifacts.browserTrace = `${name}/browser.zip`;
            }
            await prepared?.close();
          }
          report.runs.push(record);
          await persist();
          console.log(`END ${name} ${record.outcome} ${record.stage ?? ''} ${record.error ?? ''}`);
        }
      }
  } finally {
    await browser.close();
    await hosts.close();
  }
  return report;
}
