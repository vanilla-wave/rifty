import { buildChildFsArtifact } from './child-fs-artifact.mjs';

export const CHILD_FS_DEADLINES = Object.freeze({
  serverReadyMs: 90_000,
  sampleMs: 600_000,
  cleanupMs: 30_000,
});

function inspectedError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

function deadline(operation, timeoutMs, label) {
  let timer;
  operation.catch(() => {});
  return Promise.race([
    operation,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function failureRace(signal, label) {
  return signal.then(() => {
    throw new Error(`${label} failure signal resolved without an error`);
  });
}

function observeFailure(signal, label) {
  const observation = { error: undefined };
  signal.then(
    () => {
      observation.error = new Error(`${label} failure signal resolved without an error`);
    },
    (error) => {
      observation.error = inspectedError(error);
    },
  );
  return observation;
}

function guarded(operation, timeoutMs, label, failureSignals) {
  return deadline(
    Promise.race([
      operation,
      ...failureSignals.map(({ signal, label: failureLabel }) => failureRace(signal, failureLabel)),
    ]),
    timeoutMs,
    label,
  );
}

async function closeGuarded(close, timeoutMs, label, failureSignals) {
  let closing;
  try {
    closing = Promise.resolve(close());
  } catch (error) {
    throw inspectedError(error);
  }
  return await guarded(closing, timeoutMs, label, failureSignals);
}

function throwFailures(primary, cleanupFailures) {
  const failures = [
    ...(primary === undefined ? [] : [inspectedError(primary)]),
    ...cleanupFailures.map(inspectedError),
  ].filter((error, index, values) => values.indexOf(error) === index);
  if (failures.length === 0) return;
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(failures, 'child fs orchestration and cleanup failed');
}

export async function orchestrateChildFs(options, actions, deadlineOverrides = {}) {
  const deadlines = { ...CHILD_FS_DEADLINES, ...deadlineOverrides };
  let server;
  let browser;
  let browserFailure;
  let artifact;
  let primary;
  let serverFailure;
  try {
    server = await actions.startServer(options.port);
    serverFailure = observeFailure(server.failed, 'child fs dev server');
    await guarded(server.ready, deadlines.serverReadyMs, 'child fs dev server readiness', [
      { signal: server.failed, label: 'child fs dev server' },
    ]);
    const baseUrl = `http://localhost:${options.port}`;
    browser = await guarded(
      actions.launchBrowser(baseUrl),
      deadlines.sampleMs,
      'child fs browser launch',
      [{ signal: server.failed, label: 'child fs dev server' }],
    );
    browserFailure = observeFailure(browser.failed, 'child fs browser page');
    const failures = [
      { signal: server.failed, label: 'child fs dev server' },
      { signal: browser.failed, label: 'child fs browser page' },
    ];
    const samples = [];
    for (let ordinal = 1; ordinal <= options.runs; ordinal += 1) {
      for (const lane of ['product-coi', 'in-realm']) {
        samples.push(
          await guarded(
            browser.runSample(lane, ordinal),
            deadlines.sampleMs,
            `child fs ${lane}:${ordinal}`,
            failures,
          ),
        );
      }
    }
    artifact = buildChildFsArtifact({
      generatedAt: options.generatedAt,
      gitSha: options.gitSha,
      browserVersion: browser.version,
      runs: options.runs,
      samples,
    });
  } catch (error) {
    primary = error;
  }

  const cleanupFailures = [];
  if (browser !== undefined) {
    try {
      await closeGuarded(browser.close, deadlines.cleanupMs, 'child fs browser cleanup', [
        { signal: browser.failed, label: 'child fs browser page' },
        ...(server === undefined ? [] : [{ signal: server.failed, label: 'child fs dev server' }]),
      ]);
    } catch (error) {
      cleanupFailures.push(error);
    }
    if (browserFailure?.error !== undefined) cleanupFailures.push(browserFailure.error);
    if (serverFailure?.error !== undefined) cleanupFailures.push(serverFailure.error);
  }
  if (server !== undefined) {
    try {
      await closeGuarded(server.close, deadlines.cleanupMs, 'child fs dev server cleanup', [
        { signal: server.failed, label: 'child fs dev server' },
      ]);
    } catch (error) {
      cleanupFailures.push(error);
    }
    if (serverFailure?.error !== undefined) cleanupFailures.push(serverFailure.error);
  }
  throwFailures(primary, cleanupFailures);
  if (artifact === undefined) throw new Error('child fs orchestration produced no artifact');
  actions.publish(options.out, `${JSON.stringify(artifact, null, 2)}\n`);
  return artifact;
}
