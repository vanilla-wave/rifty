import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { type Browser, chromium } from '@playwright/test';
import { getAgentPromptProfile } from '@riftydev/agent';
import { type Config, readKey, redact, redactJson, secretValues, taskSet } from './config.ts';
import { diffTrees } from './files.ts';
import { prepareLocal } from './lanes/local-reference.ts';
import { codexIsolation } from './lanes/native-codex.ts';
import { prepareNoCoi } from './lanes/rifty-no-coi.ts';
import { prepareRifty } from './lanes/rifty.ts';
import type { Lane, Prepared } from './lanes/types.ts';
import { emptyMetrics } from './metrics.ts';
import { digest, resolvePlan } from './plan.ts';
import { type Report, type Run, caveat, privateReport, writeReport } from './report.ts';
import { services } from './services.ts';
import type { Task } from './tasks.ts';
export async function run(
  config: Config,
  tasks: Task[],
  lanes: Lane[],
  output: string,
  control?: string,
) {
  if (!config.endpoint) throw new Error('Endpoint required: --config or --mock-model');
  const endpoint = config.endpoint;
  const key = readKey(endpoint);
  const secrets = secretValues(endpoint, key);
  const profile = getAgentPromptProfile().id;
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output); // Exclusive series admission: never resume or overwrite.
  const plan = await resolvePlan(config, tasks, lanes);
  const stop = new AbortController();
  let active: Prepared | undefined;
  let browser: Browser | undefined;
  const interrupt = () => {
    stop.abort();
    void browser?.close().catch(() => {});
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const report: Report = {
    header: {
      purpose: control ? 'controls' : endpoint.id === 'scripted' ? 'smoke' : 'quality',
      control,
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
      model: endpoint.id,
      profile,
      taskSet: tasks[0]?.corpus ?? taskSet,
      endpoint,
      ...(config.codex === undefined
        ? {}
        : {
            codex: {
              ...config.codex,
              isolation: codexIsolation,
              sandbox: 'workspace-write',
              approval: 'automatic review',
              budgetAdmission: 'observed tool-event cancellation; may overshoot',
            },
          }),
      limits: config.limits,
      ...(config.noCoiPolicies === undefined ? {} : { noCoiPolicies: config.noCoiPolicies }),
      runsPerTask: config.runsPerTask,
      toolContextCaveat: caveat,
      unsupported: [
        'rifty-no-coi/node-endpoint: installed-bin resident preview only; selected trials retained',
      ],
      plan,
      series: { status: 'running', trials: plan.trials },
    },
    runs: [],
  };
  const persist = () => writeReport(output, privateReport(report, secrets));
  let hosts: Awaited<ReturnType<typeof services>> | undefined;
  let failure: unknown;
  try {
    await persist(); // The full matrix exists even if host/browser setup fails.
    if (stop.signal.aborted) throw new Error('Series interrupted');
    const supported = lanes.filter((lane) =>
      tasks.some((task) => !(task.node && lane === 'rifty-no-coi')),
    );
    hosts = await services(supported, config.playgroundPort, output);
    if (stop.signal.aborted) throw new Error('Series interrupted');
    // Persist partial evidence before Playwright's default SIGINT process exit.
    browser = await chromium.launch({ handleSIGINT: false });
    report.header.versions.chromium = browser.version();
    for (const trial of plan.trials) {
      if (stop.signal.aborted) break;
      const task = tasks.find((task) => task.id === trial.task)!;
      const lane = trial.lane;
      const index = trial.runIndex;
      report.header.series!.active = trial;
      await persist();
      const name = `${task.id}/${lane}/${index}`;
      const dir = join(output, name);
      await mkdir(dir, { recursive: true });
      console.log(`START ${name}`);
      const record: Run = {
        ...emptyMetrics(),
        task: task.id,
        lane,
        runIndex: index,
        attemptStartedAt: new Date().toISOString(),
        profile: lane === 'native-codex' ? 'codex-default/unconfigured' : profile,
        agentStatus: control ? 'not-run' : 'error',
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
        if (task.node && lane === 'rifty-no-coi')
          throw new Error('node-endpoint is unsupported in rifty-no-coi');
        const input = { browser, task, config, endpoint, key, dir, signal: stop.signal, ...hosts };
        prepared = await (lane === 'rifty'
          ? prepareRifty(input)
          : lane === 'rifty-no-coi'
            ? prepareNoCoi(input)
            : prepareLocal(input, lane === 'native-codex' ? 'codex' : 'pi'));
        active = prepared;
        if (prepared.codexVersion && report.header.codex) {
          report.header.codex.cliVersion = prepared.codexVersion;
          report.header.versions.codexCli = prepared.codexVersion;
          record.profile = `codex-default/${prepared.codexVersion}`;
        }
        if (stop.signal.aborted) throw new Error('Series interrupted during setup');
        await writeFile(
          join(dir, 'before.json'),
          redactJson(prepared.before, secrets, 2, 'payload'),
        );
        record.artifacts.before = `${name}/before.json`;
        record.initialFilesSha256 = digest(
          JSON.stringify(Object.entries(prepared.before).sort(([a], [b]) => a.localeCompare(b))),
        );
        record.initialLockfileSha256 =
          prepared.before['package-lock.json'] === undefined
            ? null
            : digest(prepared.before['package-lock.json']);
        if (prepared.workspace) record.artifacts.workspace = relative(output, prepared.workspace);
        if (!secrets.length) {
          await prepared.context.tracing.start({
            screenshots: true,
            snapshots: false,
            sources: false,
          });
          tracing = true;
        }
        record.stage = 'agent';
        started = Date.now();
        if (control) {
          const patch = task.controls?.[control];
          if (!patch) throw new Error('Control unavailable');
          await prepared.apply(patch);
        }
        if (!control) record.agentStartedAt = new Date().toISOString();
        const observation = control
          ? {
              ...emptyMetrics(),
              agentStatus: 'not-run',
              turns: 0,
              toolCalls: 0,
              usage: null,
              trace: { control, noModelInvocation: true },
              terminalTail: '',
            }
          : await prepared.run();
        record.elapsedMs = Date.now() - started;
        if (!control) record.agentFinishedAt = new Date().toISOString();
        const { trace, ...metrics } = observation;
        Object.assign(record, metrics);
        await writeFile(join(dir, 'trace.json'), redactJson(trace, secrets, 2));
        {
          const after = await prepared.snapshot();
          await writeFile(join(dir, 'after.json'), redactJson(after, secrets, 2, 'payload'));
          record.artifacts.after = `${name}/after.json`;
          record.finalDiff = diffTrees(prepared.before, after);
        }
        record.stage = 'judge';
        record.judgeStartedAt = new Date().toISOString();
        try {
          if (tracing) await prepared.context.tracing.group(`judge:${task.id}`);
          if (task.commandJudge) {
            await prepared.apply({ [task.commandJudge.path]: task.commandJudge.text });
            const receipt = await prepared.command(`node ${task.commandJudge.path}`);
            const pass =
              receipt.exitCode === 0 &&
              receipt.stdout.split(/\r?\n/).includes(task.commandJudge.marker);
            record.judge = {
              pass,
              probes: [
                { name: 'trusted same-origin semantic regressions', pass, evidence: receipt },
              ],
            };
          } else {
            if (!task.judge) throw new Error('Task has no judge');
            record.judge = await task.judge(await prepared.preview());
          }
          if (!secrets.length) {
            await prepared.page.screenshot({ path: join(dir, 'screen.png') });
            record.artifacts.screen = `${name}/screen.png`;
          }
        } finally {
          if (tracing) await prepared.context.tracing.groupEnd();
          record.judgeFinishedAt = new Date().toISOString();
        }
        record.outcome =
          record.agentStatus === 'budget-exceeded'
            ? 'budget-exceeded'
            : record.contextExceeded
              ? 'context-exceeded'
              : (record.agentStatus === 'done' || (control && record.agentStatus === 'not-run')) &&
                  record.judge.pass
                ? 'pass'
                : 'fail';
        record.stage = undefined;
      } catch (error) {
        record.error = redact(
          error instanceof Error ? (error.stack ?? error.message) : String(error),
          secrets,
        );
        record.elapsedMs ||= Date.now() - started;
        if (record.agentStatus === 'budget-exceeded') record.outcome = 'budget-exceeded';
        else if (record.contextExceeded) record.outcome = 'context-exceeded';
        if (prepared)
          try {
            const after = await prepared.snapshot();
            await writeFile(join(dir, 'after.json'), redactJson(after, secrets, 2, 'payload'));
            record.artifacts.after = `${name}/after.json`;
            record.finalDiff = diffTrees(prepared.before, after);
          } catch (snapshotError) {
            record.error += `\nSnapshot failed: ${redact(String(snapshotError), secrets)}`;
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
        if (!stop.signal.aborted) {
          report.runs.push(record);
          await persist(); // Completed result survives tracing/host cleanup errors.
        }
        if (tracing && prepared && !stop.signal.aborted) {
          await prepared.context.tracing.stop({ path: join(dir, 'browser.zip') });
          record.artifacts.browserTrace = `${name}/browser.zip`;
        }
        await prepared?.close();
        record.completedAt = new Date().toISOString();
        active = undefined;
      }
      if (stop.signal.aborted) break;
      report.header.series!.active = undefined;
      await persist();
      console.log(`END ${name} ${record.outcome} ${record.stage ?? ''} ${record.error ?? ''}`);
    }
    report.header.series!.status = stop.signal.aborted ? 'interrupted' : 'completed';
  } catch (error) {
    report.header.series!.status = stop.signal.aborted ? 'interrupted' : 'failed';
    report.header.series!.error = redact(String(error), secrets);
    if (!stop.signal.aborted) failure = error;
  } finally {
    if (stop.signal.aborted) report.header.series!.status = 'interrupted';
    // Teardown always runs, even when the evidence disk becomes unwritable.
    try {
      await persist();
    } catch (error) {
      failure ??= error;
    }
    for (const close of [() => active?.close(), () => browser?.close(), () => hosts?.close()]) {
      try {
        await close();
      } catch (error) {
        failure ??= error;
        report.header.series!.status = stop.signal.aborted ? 'interrupted' : 'failed';
        report.header.series!.error = redact(`Cleanup failed: ${String(error)}`, secrets);
      }
    }
    report.header.series!.finishedAt = new Date().toISOString();
    try {
      await persist();
    } catch (error) {
      failure ??= error;
    }
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
  if (failure !== undefined) throw failure;
  return report;
}
