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

export const NODE_CLI_EVAL_ORACLE_VERSION = 'v24.16.0';

export function assertNodeCliEvalOracleVersion(actual: string): void {
  if (actual !== NODE_CLI_EVAL_ORACLE_VERSION) {
    throw new Error(
      `node-cli-eval oracle requires ${NODE_CLI_EVAL_ORACLE_VERSION}; received ${actual}`,
    );
  }
}

export type NodeCliEvalSeparatedOption =
  | '-e'
  | '--eval'
  | '-pe'
  | '-p'
  | '--print'
  | `--print=${string}`;

export type NodeCliEvalSourceState = 'missing' | 'empty' | 'nonempty';

interface NodeCliEvalAcceptedSourceTerminatorExpectation {
  readonly kind: 'accepted';
  readonly source: string;
  readonly print: boolean;
  readonly execArgv: readonly string[];
  readonly scriptArgs: readonly string[];
}

interface NodeCliEvalUsageSourceTerminatorExpectation {
  readonly kind: 'usage-error';
  readonly stderrOption: '-e' | '--eval';
}

export interface NodeCliEvalSourceTerminatorCase {
  readonly label: string;
  readonly option: NodeCliEvalSeparatedOption;
  readonly sourceState: NodeCliEvalSourceState;
  readonly nodeArgv: readonly string[];
  readonly expected:
    | NodeCliEvalAcceptedSourceTerminatorExpectation
    | NodeCliEvalUsageSourceTerminatorExpectation;
}

const SEPARATED_OPTION_CONTRACTS = Object.freeze([
  Object.freeze({
    label: 'short-eval',
    option: '-e',
    print: false,
    source: 'mandatory',
    stderrOption: '-e',
  }),
  Object.freeze({
    label: 'long-eval',
    option: '--eval',
    print: false,
    source: 'mandatory',
    stderrOption: '--eval',
  }),
  Object.freeze({
    label: 'combined-print-eval',
    option: '-pe',
    print: true,
    source: 'mandatory',
    stderrOption: '--eval',
  }),
  Object.freeze({
    label: 'short-print',
    option: '-p',
    print: true,
    source: 'optional',
  }),
  Object.freeze({
    label: 'long-print',
    option: '--print',
    print: true,
    source: 'optional',
  }),
  Object.freeze({
    label: 'print-equals-ignored',
    option: '--print=ignored',
    print: true,
    source: 'optional',
  }),
  Object.freeze({
    label: 'print-equals-distinct-nonempty',
    option: '--print=not-the-source',
    print: true,
    source: 'optional',
  }),
  Object.freeze({
    label: 'print-equals-empty',
    option: '--print=',
    print: true,
    source: 'optional',
  }),
] as const);

const SOURCE_STATES = Object.freeze(['missing', 'empty', 'nonempty'] as const);

/**
 * One raw-argv Cartesian contract for every separated eval/print spelling.
 * Native Node validates these expectations before the same rows reach rifty.
 */
export function nodeCliEvalSourceTerminatorMatrix(
  nonemptySource: string,
  scriptArgs: readonly string[] = ['x'],
): readonly NodeCliEvalSourceTerminatorCase[] {
  if (nonemptySource.length === 0 || nonemptySource === '--') {
    throw new TypeError('nonemptySource must be non-empty and distinct from the option terminator');
  }
  const trailingArgs = strings(scriptArgs, 'scriptArgs');
  const cases = SEPARATED_OPTION_CONTRACTS.flatMap((contract) =>
    SOURCE_STATES.map((sourceState): NodeCliEvalSourceTerminatorCase => {
      const label = `source-terminator-${contract.label}-${sourceState}`;
      if (sourceState === 'missing') {
        const nodeArgv = Object.freeze([contract.option, '--']);
        if (contract.source === 'mandatory') {
          return Object.freeze({
            label,
            option: contract.option,
            sourceState,
            nodeArgv,
            expected: Object.freeze({
              kind: 'usage-error',
              stderrOption: contract.stderrOption,
            }),
          });
        }
        return Object.freeze({
          label,
          option: contract.option,
          sourceState,
          nodeArgv,
          expected: Object.freeze({
            kind: 'accepted',
            source: '',
            print: contract.print,
            execArgv: Object.freeze([contract.option]),
            scriptArgs: Object.freeze([]),
          }),
        });
      }

      if (sourceState === 'empty') {
        const nodeArgv = Object.freeze([contract.option, '', '--', ...trailingArgs]);
        const mandatory = contract.source === 'mandatory';
        return Object.freeze({
          label,
          option: contract.option,
          sourceState,
          nodeArgv,
          expected: Object.freeze({
            kind: 'accepted',
            source: '',
            print: contract.print,
            execArgv: Object.freeze(mandatory ? [contract.option, ''] : [contract.option]),
            scriptArgs: Object.freeze(mandatory ? trailingArgs : ['', '--', ...trailingArgs]),
          }),
        });
      }

      return Object.freeze({
        label,
        option: contract.option,
        sourceState,
        nodeArgv: Object.freeze([contract.option, nonemptySource, '--', ...trailingArgs]),
        expected: Object.freeze({
          kind: 'accepted',
          source: nonemptySource,
          print: contract.print,
          execArgv: Object.freeze([contract.option, nonemptySource]),
          scriptArgs: trailingArgs,
        }),
      });
    }),
  );
  return Object.freeze(cases);
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

function stdioHandshake(
  value: NodeCliEvalInvocation['stdioHandshake'],
  owner: string,
): NodeCliEvalInvocation['stdioHandshake'] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 9) {
    throw new TypeError(`${owner} must contain between one and nine steps`);
  }
  return Object.freeze(
    value.map((step, index) => {
      if (typeof step !== 'object' || step === null || Array.isArray(step)) {
        throw new TypeError(`${owner}[${String(index)}] must be an object`);
      }
      const keys = Reflect.ownKeys(step);
      if (
        keys.length !== 2 ||
        !keys.includes('stream') ||
        !keys.includes('marker') ||
        (step.stream !== 'stdout' && step.stream !== 'stderr') ||
        typeof step.marker !== 'string' ||
        step.marker.length === 0
      ) {
        throw new TypeError(
          `${owner}[${String(index)}] must contain only an exact stream and non-empty marker`,
        );
      }
      return Object.freeze({ stream: step.stream, marker: step.marker });
    }),
  );
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
  if (option === '--input-type=commonjs') {
    const nested = evalSemantics(nodeArgv.slice(1), owner);
    return Object.freeze({
      ...nested,
      execArgv: Object.freeze([option, ...nested.execArgv]),
    });
  }
  if (option === '-e' || option === '--eval' || option === '-pe') {
    const source = nodeArgv[1];
    if (source === undefined || source === '--') {
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
    if (source === '--' && nodeArgv[2] !== undefined && nodeArgv[2] !== '') {
      throw new TypeError(`${owner} ${option} terminator selects a program entry, not eval`);
    }
    if (source === undefined || source === '' || source === '--') {
      return Object.freeze({
        source: '',
        print: true,
        execArgv: Object.freeze([option]),
        scriptArgs: Object.freeze(
          source === undefined ? [] : source === '--' ? nodeArgv.slice(2) : nodeArgv.slice(1),
        ),
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
    if (source === '--' && nodeArgv[2] !== undefined && nodeArgv[2] !== '') {
      throw new TypeError(`${owner} ${option} terminator selects a program entry, not eval`);
    }
    if (source === undefined || source === '' || source === '--') {
      return Object.freeze({
        source: '',
        print: true,
        execArgv: Object.freeze([option]),
        scriptArgs: Object.freeze(
          source === undefined ? [] : source === '--' ? nodeArgv.slice(2) : nodeArgv.slice(1),
        ),
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
  const handshake = stdioHandshake(value.stdioHandshake, `${owner}.stdioHandshake`);
  return Object.freeze({
    label: value.label,
    nodeArgv,
    ...(value.cwd === undefined ? {} : { cwd: value.cwd }),
    ...(handshake === undefined ? {} : { stdioHandshake: handshake }),
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

interface Utf8Tail {
  bytes: Uint8Array;
  order: number | undefined;
}

function incompleteUtf8SuffixLength(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  let lead = bytes.length - 1;
  while (lead >= 0 && (bytes[lead]! & 0xc0) === 0x80) lead -= 1;
  if (lead < 0) return 0;
  const byte = bytes[lead]!;
  const expected =
    byte >= 0xc2 && byte <= 0xdf
      ? 2
      : byte >= 0xe0 && byte <= 0xef
        ? 3
        : byte >= 0xf0 && byte <= 0xf4
          ? 4
          : 0;
  const actual = bytes.length - lead;
  if (expected === 0 || actual >= expected) return 0;
  const second = bytes[lead + 1];
  if (
    second !== undefined &&
    ((byte === 0xe0 && second < 0xa0) ||
      (byte === 0xed && second > 0x9f) ||
      (byte === 0xf0 && second < 0x90) ||
      (byte === 0xf4 && second > 0x8f))
  ) {
    return 0;
  }
  return actual;
}

function trackUtf8Tail(state: Utf8Tail, bytes: Uint8Array, order: number): void {
  const previousLength = state.bytes.length;
  const combined = new Uint8Array(previousLength + bytes.length);
  combined.set(state.bytes);
  combined.set(bytes, previousLength);
  const length = incompleteUtf8SuffixLength(combined);
  if (length === 0) {
    state.bytes = new Uint8Array();
    state.order = undefined;
    return;
  }
  const start = combined.length - length;
  state.bytes = combined.slice(start);
  state.order = start < previousLength ? (state.order ?? order) : order;
}

/** Causally release each next child write only after its predecessor is observable. */
export function createNodeCliEvalStdioHandshake(
  steps: NodeCliEvalInvocation['stdioHandshake'],
  writeToken: (token: string) => void,
): {
  observe(stream: 'stdout' | 'stderr', chunk: unknown): void;
  finish(): void;
} {
  if (steps === undefined) {
    return { observe() {}, finish() {} };
  }
  const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
  let index = 0;
  let pending = '';

  return {
    observe(stream, chunk) {
      const expected = steps[index];
      if (expected === undefined || stream !== expected.stream) return;
      pending += decoders[stream].decode(asBytes(chunk), { stream: true });
      if (!pending.includes(expected.marker)) return;
      pending = '';
      index += 1;
      writeToken(String(index));
    },
    finish() {
      if (index !== steps.length) {
        throw new Error(
          `node-cli-eval stdio handshake stopped at step ${String(index)} of ${String(steps.length)}`,
        );
      }
    },
  };
}

/** Line framing retains stream switches once the streaming decoder yields text. */
export function createNodeCliEvalCapture(): {
  push(stream: 'stdout' | 'stderr', chunk: unknown): void;
  finish(code: number | null, signal: string | null): NodeCliEvalRawOutcome;
} {
  const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
  const pending = { stdout: '', stderr: '' };
  const pendingOrder: Record<'stdout' | 'stderr', number | undefined> = {
    stdout: undefined,
    stderr: undefined,
  };
  const tails = {
    stdout: { bytes: new Uint8Array(), order: undefined } satisfies Utf8Tail,
    stderr: { bytes: new Uint8Array(), order: undefined } satisfies Utf8Tail,
  };
  const output = { stdout: '', stderr: '' };
  const frames: (NodeCliEvalFrame & { readonly order: number; readonly ordinal: number })[] = [];
  let activeStream: 'stdout' | 'stderr' | undefined;
  let order = 0;
  let ordinal = 0;

  const frame = (stream: 'stdout' | 'stderr', text: string, frameOrder: number): void => {
    frames.push({ stream, text, order: frameOrder, ordinal: ordinal++ });
  };

  const flushPending = (stream: 'stdout' | 'stderr'): void => {
    if (pending[stream].length === 0) return;
    frame(stream, pending[stream], pendingOrder[stream] ?? order);
    pending[stream] = '';
    pendingOrder[stream] = undefined;
  };

  const append = (stream: 'stdout' | 'stderr', text: string, writeOrder: number): void => {
    output[stream] += text;
    if (text.length === 0) return;
    pendingOrder[stream] ??= writeOrder;
    pending[stream] += text;
    for (;;) {
      const newline = pending[stream].indexOf('\n');
      if (newline === -1) return;
      frame(stream, pending[stream].slice(0, newline + 1), pendingOrder[stream] ?? writeOrder);
      pending[stream] = pending[stream].slice(newline + 1);
      pendingOrder[stream] = pending[stream].length === 0 ? undefined : writeOrder;
    }
  };

  return {
    push(stream, chunk) {
      const writeOrder = order++;
      const bytes = asBytes(chunk);
      trackUtf8Tail(tails[stream], bytes, writeOrder);
      if (activeStream !== undefined && activeStream !== stream) flushPending(activeStream);
      activeStream = stream;
      append(stream, decoders[stream].decode(bytes, { stream: true }), writeOrder);
    },
    finish(code, signal) {
      const flushes = [
        {
          stream: 'stdout' as const,
          text: decoders.stdout.decode(),
          order: tails.stdout.order ?? order,
          ordinal: 0,
        },
        {
          stream: 'stderr' as const,
          text: decoders.stderr.decode(),
          order: tails.stderr.order ?? order + 1,
          ordinal: 1,
        },
      ].sort((left, right) => left.order - right.order || left.ordinal - right.ordinal);
      for (const flush of flushes) append(flush.stream, flush.text, flush.order);
      flushPending('stdout');
      flushPending('stderr');
      return {
        ...output,
        frames: frames
          .sort((left, right) => left.order - right.order || left.ordinal - right.ordinal)
          .map(({ stream, text }) => ({ stream, text })),
        code,
        signal,
      };
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
  const userFrameLocation = lines
    .find((line, index) => index > error && /^\s+at .*\[eval\]:\d+:\d+\)?$/u.test(line))
    ?.match(/\[eval\]:\d+:\d+/u)?.[0];
  const preludeEnd = firstBlank === -1 ? error : firstBlank;
  const selected = [...lines.slice(header, preludeEnd), '', lines[error] ?? ''];
  if (userFrameLocation !== undefined) selected.push(`    at ${userFrameLocation}`);
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
