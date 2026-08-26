import { childFsScenarioIdentity } from '../child-fs/scenario.mjs';

const ESC = String.fromCharCode(27);
const ANSI_CSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'gu');
const TERMINAL_LINE_RESTART = new RegExp(`${ESC}\\[(?:1)?G`, 'gu');
const LANES = ['product-coi', 'in-realm'];
const TOPOLOGY = Object.freeze({
  'product-coi': 'owner-sync-rpc-kernel-child',
  'in-realm': 'single-in-realm-worker',
});

function record(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

function exactRecord(value, keys, label) {
  const result = record(value, label);
  const actual = Object.keys(result).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} has unexpected fields: ${actual.join(', ')}`);
  }
  return result;
}

function string(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return value;
}

function zeroExit(value, label) {
  if (value !== 0) throw new TypeError(`${label} must be exit code 0`);
  return 0;
}

function matches(text, pattern) {
  return [...text.matchAll(pattern)];
}

function countLiteral(text, value) {
  if (value.length === 0) return 0;
  return text.split(value).length - 1;
}

function terminalProof(text) {
  return text
    .replace(/\r\n/gu, '\n')
    .replaceAll('\r', '\n')
    .replace(TERMINAL_LINE_RESTART, '\n')
    .replace(ANSI_CSI, '');
}

function parseVite(value, label) {
  const input = exactRecord(value, ['exitCode', 'rawOutput', 'emittedJavaScript', 'marker'], label);
  const exitCode = zeroExit(input.exitCode, `${label}.exitCode`);
  const rawOutput = string(input.rawOutput, `${label}.rawOutput`);
  const proof = terminalProof(rawOutput);
  const emittedJavaScript = string(input.emittedJavaScript, `${label}.emittedJavaScript`);
  const marker = string(input.marker, `${label}.marker`);
  const moduleRows = matches(proof, /(?:^|\n)✓\s+(-?\d+)\s+modules transformed\.\r?(?=\n|$)/gu);
  if (moduleRows.length !== 1) {
    throw new TypeError(`${label} must report one module count; found ${moduleRows.length}`);
  }
  const transformedModules = Number(moduleRows[0]?.[1]);
  positiveInteger(transformedModules, `${label}.transformedModules`);
  const timeRows = matches(
    proof,
    /(?:^|\n)✓\s+built in (-?(?:\d+(?:\.\d+)?|\.\d+))(ms|s)\r?(?=\n|$)/gu,
  );
  if (timeRows.length !== 1) throw new TypeError(`${label} must report one self time`);
  const rawTime = Number(timeRows[0]?.[1]);
  if (!Number.isFinite(rawTime) || rawTime <= 0) {
    throw new TypeError(`${label}.selfTime must be positive`);
  }
  const selfTimeSeconds = timeRows[0]?.[2] === 'ms' ? rawTime / 1000 : rawTime;
  if (countLiteral(emittedJavaScript, marker) !== 1) {
    throw new TypeError(`${label}.emittedJavaScript must contain the marker exactly once`);
  }
  return {
    exitCode,
    rawOutput,
    emittedJavaScript,
    marker,
    transformedModules,
    selfTimeSeconds,
  };
}

function parseExpress(value, label) {
  const input = exactRecord(value, ['exitCode', 'rawOutput', 'marker'], label);
  const exitCode = zeroExit(input.exitCode, `${label}.exitCode`);
  const rawOutput = string(input.rawOutput, `${label}.rawOutput`);
  const proof = terminalProof(rawOutput);
  const marker = string(input.marker, `${label}.marker`);
  const readyRows = matches(
    proof,
    /(?:^|\n)RIFTY_EXPRESS_READY (\S+) (-?(?:\d+(?:\.\d+)?|\.\d+))\r?(?=\n|$)/gu,
  );
  const closedRows = matches(proof, /(?:^|\n)RIFTY_EXPRESS_CLOSED (\S+)\r?(?=\n|$)/gu);
  if (
    readyRows.length !== 1 ||
    closedRows.length !== 1 ||
    readyRows[0]?.[1] !== marker ||
    closedRows[0]?.[1] !== marker ||
    (readyRows[0]?.index ?? Number.POSITIVE_INFINITY) >=
      (closedRows[0]?.index ?? Number.NEGATIVE_INFINITY)
  ) {
    throw new TypeError(`${label} must report one ready and one close proof`);
  }
  const startToListeningMs = Number(readyRows[0]?.[2]);
  if (!Number.isFinite(startToListeningMs) || startToListeningMs <= 0) {
    throw new TypeError(`${label}.startToListeningMs must be positive`);
  }
  return { exitCode, rawOutput, marker, startToListeningMs };
}

function parseRawSample(value, label) {
  const input = exactRecord(
    value,
    ['lane', 'topology', 'ordinal', 'ownerLoad', 'vite', 'express'],
    label,
  );
  if (!LANES.includes(input.lane)) throw new TypeError(`${label}.lane is invalid`);
  const lane = input.lane;
  if (input.topology !== TOPOLOGY[lane]) {
    throw new TypeError(`${label}.topology does not match ${lane}`);
  }
  const ordinal = positiveInteger(input.ordinal, `${label}.ordinal`);
  if (input.ownerLoad !== 'idle') throw new TypeError(`${label}.ownerLoad must be idle`);
  const vite = parseVite(input.vite, `${label}.vite`);
  const express = parseExpress(input.express, `${label}.express`);
  if (vite.marker !== express.marker) {
    throw new TypeError(`${label} Vite and Express markers must match`);
  }
  return {
    lane,
    topology: TOPOLOGY[lane],
    ordinal,
    ownerLoad: 'idle',
    vite,
    express,
  };
}

function validateSampleSet(samples, runs, label, parser) {
  if (!Array.isArray(samples) || samples.length !== runs * LANES.length) {
    throw new TypeError(`${label} must contain exactly ${runs} samples per lane`);
  }
  const parsed = samples.map((sample, index) => parser(sample, `${label}[${index}]`));
  const keys = new Set(parsed.map(({ lane, ordinal }) => `${lane}:${ordinal}`));
  if (keys.size !== parsed.length) throw new TypeError(`${label} contains duplicate ordinals`);
  const markers = new Set(parsed.map(({ vite }) => vite.marker));
  if (markers.size !== parsed.length) throw new TypeError(`${label} contains replayed markers`);
  for (const lane of LANES) {
    for (let ordinal = 1; ordinal <= runs; ordinal += 1) {
      if (!keys.has(`${lane}:${ordinal}`)) {
        throw new TypeError(`${label} is missing ${lane}:${ordinal}`);
      }
    }
  }
  return parsed;
}

function validateGeneratedAt(value) {
  const generatedAt = string(value, 'artifact.generatedAt');
  if (new Date(generatedAt).toISOString() !== generatedAt) {
    throw new TypeError('artifact.generatedAt must be an exact ISO timestamp');
  }
  return generatedAt;
}

function validateGitSha(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new TypeError('artifact.gitSha must be 40 lowercase hex characters');
  }
  return value;
}

function parseArtifactSample(value, label) {
  const input = exactRecord(
    value,
    ['lane', 'topology', 'ordinal', 'ownerLoad', 'vite', 'express'],
    label,
  );
  const vite = exactRecord(
    input.vite,
    [
      'exitCode',
      'rawOutput',
      'emittedJavaScript',
      'marker',
      'transformedModules',
      'selfTimeSeconds',
    ],
    `${label}.vite`,
  );
  const express = exactRecord(
    input.express,
    ['exitCode', 'rawOutput', 'marker', 'startToListeningMs'],
    `${label}.express`,
  );
  const parsed = parseRawSample(
    {
      ...input,
      vite: {
        exitCode: vite.exitCode,
        rawOutput: vite.rawOutput,
        emittedJavaScript: vite.emittedJavaScript,
        marker: vite.marker,
      },
      express: {
        exitCode: express.exitCode,
        rawOutput: express.rawOutput,
        marker: express.marker,
      },
    },
    label,
  );
  if (
    vite.transformedModules !== parsed.vite.transformedModules ||
    vite.selfTimeSeconds !== parsed.vite.selfTimeSeconds ||
    express.startToListeningMs !== parsed.express.startToListeningMs
  ) {
    throw new TypeError(`${label} derived values do not match raw output`);
  }
  return parsed;
}

export function validateChildFsRawSample(value) {
  return parseRawSample(value, 'child-fs lane sample');
}

export function buildChildFsArtifact(value) {
  const input = exactRecord(
    value,
    ['generatedAt', 'gitSha', 'browserVersion', 'runs', 'samples'],
    'artifact input',
  );
  const identity = childFsScenarioIdentity();
  const runs = positiveInteger(input.runs, 'artifact.runs');
  return validateChildFsArtifact({
    schemaVersion: 1,
    generatedAt: validateGeneratedAt(input.generatedAt),
    gitSha: validateGitSha(input.gitSha),
    browserVersion: string(input.browserVersion, 'artifact.browserVersion'),
    scenarioDigest: identity.scenarioDigest,
    dependencyDigest: identity.dependencyDigest,
    runs,
    samples: validateSampleSet(input.samples, runs, 'artifact.samples', parseRawSample),
  });
}

export function validateChildFsArtifact(value) {
  const artifact = exactRecord(
    value,
    [
      'schemaVersion',
      'generatedAt',
      'gitSha',
      'browserVersion',
      'scenarioDigest',
      'dependencyDigest',
      'runs',
      'samples',
    ],
    'artifact',
  );
  if (artifact.schemaVersion !== 1) throw new TypeError('artifact.schemaVersion must be 1');
  const identity = childFsScenarioIdentity();
  if (
    artifact.scenarioDigest !== identity.scenarioDigest ||
    artifact.dependencyDigest !== identity.dependencyDigest
  ) {
    throw new TypeError('artifact scenario/dependency digest does not match canonical scenario');
  }
  const runs = positiveInteger(artifact.runs, 'artifact.runs');
  return {
    schemaVersion: 1,
    generatedAt: validateGeneratedAt(artifact.generatedAt),
    gitSha: validateGitSha(artifact.gitSha),
    browserVersion: string(artifact.browserVersion, 'artifact.browserVersion'),
    scenarioDigest: identity.scenarioDigest,
    dependencyDigest: identity.dependencyDigest,
    runs,
    samples: validateSampleSet(artifact.samples, runs, 'artifact.samples', parseArtifactSample),
  };
}
