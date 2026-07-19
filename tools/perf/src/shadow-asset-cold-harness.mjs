const MEASURED_CONTEXT_COUNT = 5;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function unmeasured(note) {
  return { status: 'unmeasured', note };
}

function modeLabel(mode) {
  if (mode === 'standard') return 'standard';
  if (mode === 'eddy') return 'Eddy';
  throw new TypeError("mode must be 'standard' or 'eddy'");
}

function contextPort(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.measure !== 'function' ||
    typeof value.close !== 'function'
  ) {
    throw new TypeError('browser context must expose measure() and close()');
  }
  return value;
}

async function settleWarmup(createContext, seen) {
  let context;
  let failure = null;
  try {
    context = contextPort(await createContext({ kind: 'warmup' }));
    seen.add(context);
    await context.measure();
  } catch (error) {
    failure = errorMessage(error);
  }
  if (context !== undefined) {
    try {
      await context.close();
    } catch (error) {
      const closeFailure = errorMessage(error);
      failure = failure === null ? closeFailure : `${failure}; ${closeFailure}`;
    }
  }
  return failure;
}

/**
 * Run the fixed cold-fill regime. The adapter owns Chromium details; this
 * boundary owns the non-negotiable topology: one discarded context, five fresh
 * measured contexts, mandatory close, and no partial result.
 */
export async function runShadowAssetColdContexts({ mode, createContext, buildRun }) {
  const rowLabel = `${modeLabel(mode)} shadow-asset cold`;
  if (typeof createContext !== 'function') throw new TypeError('createContext must be a function');
  if (typeof buildRun !== 'function') throw new TypeError('buildRun must be a function');

  const seen = new Set();
  const warmupFailure = await settleWarmup(createContext, seen);
  if (warmupFailure !== null) {
    return unmeasured(`${rowLabel} warm-up: ${warmupFailure}`);
  }

  const runs = [];
  const failures = [];
  for (let index = 0; index < MEASURED_CONTEXT_COUNT; index += 1) {
    const label = `${rowLabel} run ${index + 1}/${MEASURED_CONTEXT_COUNT}`;
    let context;
    let raw;
    let failure = null;
    try {
      context = contextPort(await createContext({ kind: 'measured', index }));
      if (seen.has(context)) return unmeasured(`${label}: browser context was reused`);
      seen.add(context);
      raw = await context.measure();
    } catch (error) {
      failure = errorMessage(error);
    }

    if (context !== undefined) {
      try {
        await context.close();
      } catch (error) {
        const closeFailure = errorMessage(error);
        failure = failure === null ? closeFailure : `${failure}; ${closeFailure}`;
      }
    }

    if (failure === null) {
      try {
        const built = buildRun(raw);
        if (built?.ok === true) runs.push(built.run);
        else failure = typeof built?.note === 'string' ? built.note : 'run proof was refused';
      } catch (error) {
        failure = errorMessage(error);
      }
    }
    if (failure !== null) failures.push(`${label}: ${failure}`);
  }

  if (failures.length > 0) return unmeasured(failures.join('; '));
  if (runs.length !== MEASURED_CONTEXT_COUNT) {
    return unmeasured(
      `${rowLabel} produced ${runs.length}/${MEASURED_CONTEXT_COUNT} complete runs`,
    );
  }
  return { status: 'measured', runs };
}

export function runStandardShadowAssetColdContexts({ createContext, buildRun }) {
  return runShadowAssetColdContexts({ mode: 'standard', createContext, buildRun });
}
