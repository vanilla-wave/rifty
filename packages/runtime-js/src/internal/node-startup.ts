import { NotImplementedError } from '@riftydev/io';

export interface NodeStartupOptions {
  readonly preloads: readonly string[];
  readonly conditions: readonly string[];
  readonly resolveParent: boolean;
}

/** One raw launch snapshot; option effects are derived, never carried twice. */
export function parseNodeStartup(
  execArgv: readonly string[],
  feature = 'node-entry.execArgv',
): NodeStartupOptions {
  const preloads: string[] = [];
  const conditions: string[] = [];
  let resolveParent = false;
  const operand = (index: number, flag: string): string => {
    const value = execArgv[index];
    if (typeof value !== 'string' || value.length === 0) {
      throw Object.assign(
        new Error(`Initiated Worker with invalid execArgv flags: ${flag} requires an argument`),
        { code: 'ERR_WORKER_INVALID_EXEC_ARGV' },
      );
    }
    return value;
  };
  for (let i = 0; i < execArgv.length; i++) {
    const flag = execArgv[i]!;
    if (flag === '--experimental-import-meta-resolve') {
      resolveParent = true;
      continue;
    }
    if (flag === '--conditions' || flag === '-C') {
      conditions.push(operand(++i, flag));
      continue;
    }
    if (flag.startsWith('--conditions=')) {
      conditions.push(operandValue(flag, '--conditions='));
      continue;
    }
    if (flag === '--require' || flag === '-r') {
      preloads.push(operand(++i, flag));
      continue;
    }
    if (flag.startsWith('--require=')) {
      preloads.push(operandValue(flag, '--require='));
      continue;
    }
    if (['-e', '--eval', '-pe', '-ep'].includes(flag)) {
      // Entry parsing already owns source validation; empty source is valid.
      if (typeof execArgv[++i] !== 'string') operand(i, flag);
      continue;
    }
    if (flag === '-p' || flag === '--print' || flag.startsWith('--print=')) {
      // Node ignores the = suffix of print and consumes a following source.
      if (execArgv[i + 1] !== undefined && !execArgv[i + 1]!.startsWith('-')) i++;
      continue;
    }
    if (flag.startsWith('--eval=')) continue;
    if (flag === '--input-type=commonjs' || flag === '--input-type=module') continue;
    throw new NotImplementedError(feature, `unsupported Node startup option: ${flag}`);
  }
  return {
    preloads: Object.freeze(preloads),
    conditions: Object.freeze(conditions),
    resolveParent,
  };
}
function operandValue(flag: string, prefix: string): string {
  const value = flag.slice(prefix.length);
  if (!value)
    throw Object.assign(
      new Error(`Initiated Worker with invalid execArgv flags: ${prefix} requires an argument`),
      { code: 'ERR_WORKER_INVALID_EXEC_ARGV' },
    );
  return value;
}

export function snapshotExecArgv(value: readonly string[]): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some((arg) => typeof arg !== 'string') ||
    Object.keys(value).length !== value.length
  ) {
    throw Object.assign(new TypeError('The "execArgv" argument must be an array of strings'), {
      code: 'ERR_INVALID_ARG_TYPE',
    });
  }
  return Object.freeze([...value]);
}

/** Native fork defaults use the public array and strip inherited eval source pairs. */
export function forkExecArgv(parent: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (let i = 0; i < parent.length; i++) {
    const flag = parent[i]!;
    if (['-e', '--eval', '-p', '--print', '-pe', '-ep'].includes(flag)) {
      i++;
      continue;
    }
    if (flag.startsWith('--eval=') || flag.startsWith('--print=')) continue;
    out.push(flag);
  }
  return Object.freeze(out);
}
