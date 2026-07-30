import { Buffer } from 'node:buffer';
import type { NodeCliEvalInvocation, ParityCase, ResolvedNodeCliEvalInvocation } from './types.ts';

export interface NodeCliEvalFrame {
  readonly stream: 'stdout' | 'stderr';
  readonly text: string;
}

export interface NodeCliEvalRawOutcome {
  readonly stdout: string;
  readonly stderr: string;
  readonly frames: readonly NodeCliEvalFrame[];
  readonly code: number | null;
  readonly signal: string | null;
}

export interface NodeCliEvalOutcome extends NodeCliEvalRawOutcome {
  readonly label: string;
}

const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');
const ABSOLUTE_STACK_LOCATION = /(?:^|[\s(])(?:file:\/\/)?\/[^()\s]+:\d+:\d+/u;
const ABSOLUTE_ERROR_HEADER = /^(?:file:\/\/)?\/[^()\s]+:\d+(?::\d+)?$/u;
const GENERATED_EVAL_PATH = /\.rifty-eval-[^()\s:]*/u;

const NODE_CLI_EVAL_ORACLE_VERSION = 'v24.16.0';

export function assertNodeCliEvalOracleVersion(actual: string): void {
  if (actual !== NODE_CLI_EVAL_ORACLE_VERSION) {
    throw new Error(
      `node-cli-eval oracle requires ${NODE_CLI_EVAL_ORACLE_VERSION}; received ${actual}`,
    );
  }
}

export function nodeCliEvalPreviewScope(label: string): string {
  return `parity:node-cli-eval:${label}`;
}

function strings(value: readonly string[], owner: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`${owner} must be an array of strings`);
  }
  return Object.freeze([...value]);
}

const DERIVED_INVOCATION_FIELDS = ['source', 'print', 'execArgv', 'scriptArgs'] as const;

function scriptArgs(nodeArgv: readonly string[], start: number): readonly string[] {
  return Object.freeze(nodeArgv.slice(nodeArgv[start] === '--' ? start + 1 : start));
}

function evalSemantics(
  nodeArgv: readonly string[],
  owner: string,
): Pick<ResolvedNodeCliEvalInvocation, 'source' | 'print' | 'execArgv' | 'scriptArgs'> {
  const option = nodeArgv[0];
  if (option === undefined) {
    throw new TypeError(`${owner} must contain a supported eval option`);
  }
  if (option === '-e' || option === '--eval' || option === '-pe') {
    const source = nodeArgv[1];
    if (source === undefined) {
      throw new TypeError(`${owner} ${option} requires a source argument`);
    }
    return Object.freeze({
      source,
      print: option === '-pe',
      execArgv: Object.freeze([option, source]),
      scriptArgs: scriptArgs(nodeArgv, 2),
    });
  }
  if (option === '-p' || option === '--print') {
    const source = nodeArgv[1];
    if (source === undefined) {
      return Object.freeze({
        source: '',
        print: true,
        execArgv: Object.freeze([option]),
        scriptArgs: Object.freeze([]),
      });
    }
    return Object.freeze({
      source,
      print: true,
      execArgv: Object.freeze([option, source]),
      scriptArgs: scriptArgs(nodeArgv, 2),
    });
  }
  if (option.startsWith('--eval=')) {
    const source = option.slice('--eval='.length);
    if (source.length === 0) {
      throw new TypeError(`${owner} --eval= requires a non-empty inline source`);
    }
    return Object.freeze({
      source,
      print: false,
      execArgv: Object.freeze([option]),
      scriptArgs: scriptArgs(nodeArgv, 1),
    });
  }
  if (option.startsWith('--print=')) {
    const source = nodeArgv[1];
    if (source === undefined) {
      return Object.freeze({
        source: '',
        print: true,
        execArgv: Object.freeze([option]),
        scriptArgs: Object.freeze([]),
      });
    }
    return Object.freeze({
      source,
      print: true,
      execArgv: Object.freeze([option, source]),
      scriptArgs: scriptArgs(nodeArgv, 2),
    });
  }
  throw new TypeError(`${owner} has unsupported eval option ${JSON.stringify(option)}`);
}

/** Snapshot one raw CLI invocation and derive the launch consumed by rifty. */
export function resolveNodeCliEvalInvocation(
  value: NodeCliEvalInvocation,
  owner = 'nodeCliEval invocation',
): ResolvedNodeCliEvalInvocation {
  if (typeof value !== 'object' || value === null)
    throw new TypeError(`${owner} must be an object`);
  if (typeof value.label !== 'string' || value.label.length === 0) {
    throw new TypeError(`${owner}.label must be a non-empty string`);
  }
  for (const field of DERIVED_INVOCATION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      throw new TypeError(`${owner}.${field} is derived from nodeArgv`);
    }
  }
  if (
    value.cwd !== undefined &&
    (typeof value.cwd !== 'string' ||
      !value.cwd.startsWith('/') ||
      value.cwd.split('/').some((part) => part === '..' || part === '.'))
  ) {
    throw new TypeError(`${owner}.cwd must be an absolute POSIX path without dot segments`);
  }
  if (value.evalErrorStderr !== undefined && typeof value.evalErrorStderr !== 'boolean') {
    throw new TypeError(`${owner}.evalErrorStderr must be a boolean`);
  }
  if (
    value.rejectedPromiseStdout !== undefined &&
    typeof value.rejectedPromiseStdout !== 'boolean'
  ) {
    throw new TypeError(`${owner}.rejectedPromiseStdout must be a boolean`);
  }
  const nodeArgv = strings(value.nodeArgv, `${owner}.nodeArgv`);
  return Object.freeze({
    label: value.label,
    nodeArgv,
    ...(value.cwd === undefined ? {} : { cwd: value.cwd }),
    ...(value.evalErrorStderr === undefined ? {} : { evalErrorStderr: value.evalErrorStderr }),
    ...(value.rejectedPromiseStdout === undefined
      ? {}
      : { rejectedPromiseStdout: value.rejectedPromiseStdout }),
    ...evalSemantics(nodeArgv, `${owner}.nodeArgv`),
  });
}

export function nodeCliEvalInvocations(testCase: ParityCase): {
  readonly sequential: readonly ResolvedNodeCliEvalInvocation[];
  readonly concurrent: readonly ResolvedNodeCliEvalInvocation[];
} {
  if (testCase.kind !== 'node-cli-eval' || testCase.nodeCliEval === undefined) {
    throw new TypeError("ParityCase kind 'node-cli-eval' requires nodeCliEval");
  }
  const sequential = testCase.nodeCliEval.sequential.map((value, index) =>
    resolveNodeCliEvalInvocation(value, `nodeCliEval.sequential[${String(index)}]`),
  );
  const concurrent = (testCase.nodeCliEval.concurrent ?? []).map((value, index) =>
    resolveNodeCliEvalInvocation(value, `nodeCliEval.concurrent[${String(index)}]`),
  );
  const labels = [...sequential, ...concurrent].map(({ label }) => label);
  if (new Set(labels).size !== labels.length) {
    throw new TypeError('nodeCliEval invocation labels must be unique');
  }
  if (labels.length === 0) throw new TypeError('nodeCliEval requires at least one invocation');
  if (testCase.expectedPhysicalWorkers !== labels.length) {
    throw new TypeError(
      `nodeCliEval expectedPhysicalWorkers must equal invocation count ${String(labels.length)}`,
    );
  }
  return { sequential, concurrent };
}

function asBytes(chunk: unknown): Uint8Array {
  if (typeof chunk === 'string') return Buffer.from(chunk);
  if (chunk instanceof Uint8Array) return chunk;
  throw new TypeError('node-cli-eval stream emitted a non-byte chunk');
}

/** UTF-8 line framing removes transport chunk boundaries, never stream order. */
export function createNodeCliEvalCapture(): {
  push(stream: 'stdout' | 'stderr', chunk: unknown): void;
  finish(code: number | null, signal: string | null): NodeCliEvalRawOutcome;
} {
  const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
  const pending = { stdout: '', stderr: '' };
  const output = { stdout: '', stderr: '' };
  const frames: NodeCliEvalFrame[] = [];

  const append = (stream: 'stdout' | 'stderr', text: string): void => {
    output[stream] += text;
    pending[stream] += text;
    for (;;) {
      const newline = pending[stream].indexOf('\n');
      if (newline === -1) return;
      frames.push({ stream, text: pending[stream].slice(0, newline + 1) });
      pending[stream] = pending[stream].slice(newline + 1);
    }
  };

  return {
    push(stream, chunk) {
      append(stream, decoders[stream].decode(asBytes(chunk), { stream: true }));
    },
    finish(code, signal) {
      append('stdout', decoders.stdout.decode());
      append('stderr', decoders.stderr.decode());
      if (pending.stdout.length > 0) frames.push({ stream: 'stdout', text: pending.stdout });
      if (pending.stderr.length > 0) frames.push({ stream: 'stderr', text: pending.stderr });
      return { ...output, frames, code, signal };
    },
  };
}

function normaliseText(text: string, replacements: Readonly<Record<string, string>>): string {
  let out = text.replace(/\r\n/gu, '\n').replace(ANSI_SGR, '');
  for (const [from, to] of Object.entries(replacements)) {
    if (from.length > 0) out = out.replaceAll(from, to);
  }
  return out;
}

function evalError(stderr: string): string {
  const lines = stderr.replace(/\n+$/u, '').split('\n');
  const header = lines.findIndex((line) => /^\[eval\]:\d+/u.test(line));
  if (header === -1) return stderr;
  const firstBlank = lines.findIndex((line, index) => index > header && line === '');
  const error = lines.findIndex(
    (line, index) =>
      index > header && /^(?:[A-Za-z][A-Za-z0-9_.]*(?:Error|Exception)|Error):/u.test(line),
  );
  if (error === -1) return stderr;
  const userFrame = lines.find((line, index) => index > error && /^\s+at \[eval\]:/u.test(line));
  const preludeEnd = firstBlank === -1 ? error : firstBlank;
  const selected = [...lines.slice(header, preludeEnd), '', lines[error] ?? ''];
  if (userFrame !== undefined) selected.push(userFrame);
  return `${selected.join('\n')}\n`;
}

/**
 * Reject a raw eval diagnostic before any projection can discard its physical
 * source carrier. A leak is invalid wherever it lands: before `[eval]`, as the
 * only header, or below the selected user frame.
 */
export function assertNodeCliEvalNoCarrierPath(stderr: string): void {
  const lines = stderr
    .replace(/\r\n/gu, '\n')
    .replace(ANSI_SGR, '')
    .replace(/\n+$/u, '')
    .split('\n');
  const leaked = lines.find(
    (line) =>
      GENERATED_EVAL_PATH.test(line) ||
      ABSOLUTE_STACK_LOCATION.test(line) ||
      ABSOLUTE_ERROR_HEADER.test(line),
  );
  if (leaked !== undefined) {
    throw new Error(
      `node-cli-eval raw eval stderr leaked a generated or absolute carrier path: ${JSON.stringify(leaked)}`,
    );
  }
}

function rejectedPromisePrefix(stdout: string): string {
  const rejected = stdout.match(/Promise\s*\{\s*<rejected>\s+([^\n]+)/u);
  if (rejected === null) return stdout;
  const userFrame = stdout.match(/^\s+at \[eval\]:[^\n]+/mu)?.[0];
  return `Promise { <rejected> ${rejected[1]?.trim() ?? ''}${
    userFrame === undefined ? '' : `\n${userFrame}`
  }\n`;
}

export function canonicalNodeCliEvalOutcome(
  invocation: NodeCliEvalInvocation,
  raw: NodeCliEvalRawOutcome,
  replacements: Readonly<Record<string, string>> = {},
): NodeCliEvalOutcome {
  if (invocation.evalErrorStderr === true) assertNodeCliEvalNoCarrierPath(raw.stderr);
  let stdout = normaliseText(raw.stdout, replacements);
  let stderr = normaliseText(raw.stderr, replacements);
  if (invocation.rejectedPromiseStdout === true) stdout = rejectedPromisePrefix(stdout);
  if (invocation.evalErrorStderr === true) stderr = evalError(stderr);

  let firstStdout = false;
  let firstStderr = false;
  const frames = raw.frames.flatMap((frame): NodeCliEvalFrame[] => {
    if (frame.stream === 'stdout' && invocation.rejectedPromiseStdout === true) {
      if (firstStdout || stdout.length === 0) return [];
      firstStdout = true;
      return [{ stream: 'stdout', text: stdout }];
    }
    if (frame.stream === 'stderr' && invocation.evalErrorStderr === true) {
      if (firstStderr || stderr.length === 0) return [];
      firstStderr = true;
      return [{ stream: 'stderr', text: stderr }];
    }
    return [{ stream: frame.stream, text: normaliseText(frame.text, replacements) }];
  });
  return { label: invocation.label, stdout, stderr, frames, code: raw.code, signal: raw.signal };
}

export async function runNodeCliEvalMatrix(
  testCase: ParityCase,
  run: (invocation: ResolvedNodeCliEvalInvocation) => Promise<NodeCliEvalOutcome>,
): Promise<string> {
  const { sequential, concurrent } = nodeCliEvalInvocations(testCase);
  const outcomes: NodeCliEvalOutcome[] = [];
  for (const item of sequential) outcomes.push(await run(item));
  outcomes.push(...(await Promise.all(concurrent.map(run))));
  return `${JSON.stringify(outcomes, null, 2)}\n`;
}
