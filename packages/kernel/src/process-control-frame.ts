// Process control wire frame codec, shared by the kernel manager and the runtime-js process shim.
import { decodeWorkerStdioOrderFrame } from './worker-stdio-drain.ts';

/**
 * Wire frame for the shared user-IPC/process-control channel between
 * {@link WorkerProcessHandle} and the worker-side `process` shim
 * (ADR-0045/0225). No version field — parent and child are built together.
 */
export type IpcFrame =
  | { readonly kind: 'ipc:message'; readonly payload: unknown }
  | { readonly kind: 'ipc:tty-resize'; readonly cols: number; readonly rows: number }
  | { readonly kind: 'ipc:disconnect' }
  | { readonly kind: 'control:signal'; readonly signal: string }
  | { readonly kind: 'control:self-signal'; readonly signal: string }
  | { readonly kind: 'control:self-exit'; readonly code: number }
  | { readonly kind: 'control:peer-closing' }
  | {
      readonly kind: 'control:kill-tree';
      readonly pid: number;
      readonly signal: string;
      /** The receiving realm ends with this kill: release, never terminate (ADR-0548). */
      readonly cascade: boolean;
    }
  | {
      readonly kind: 'control:stdio-order';
      readonly stream: 'stdout' | 'stderr';
      readonly order: number;
      readonly attestation: string;
    }
  | {
      readonly kind: 'control:listening';
      readonly ports: readonly number[];
      readonly previewScope?: string;
    };

export function positivePid(value: unknown, owner: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${owner} must be a positive safe integer PID`);
  }
  return value as number;
}

export function rpcRecord(
  value: unknown,
  fields: readonly string[],
  owner: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${owner} payload must be an object`);
  }
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (
    keys.length !== fields.length ||
    fields.some((field) => !Object.prototype.hasOwnProperty.call(record, field))
  ) {
    throw new TypeError(`${owner} payload must contain exactly ${fields.join(', ')}`);
  }
  return record;
}

export function ttyDimension(value: number, name: 'cols' | 'rows'): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`TTY ${name} must be a positive safe integer; received ${value}`);
  }
  return value;
}

export function controlSignal(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('process control signal must be a non-empty string');
  }
  return value;
}

export function controlExitCode(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 255) {
    throw new RangeError('process control exit code must be an unsigned byte');
  }
  return value as number;
}

export function listeningPorts(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (port) => !Number.isSafeInteger(port) || (port as number) <= 0 || (port as number) > 65_535,
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new TypeError('process listening ports must be unique valid TCP ports');
  }
  return [...(value as number[])];
}

export function decodeIpcFrame(value: unknown): IpcFrame {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('process control frame must be an object');
  }
  const kind = (value as Record<string, unknown>).kind;
  if (typeof kind !== 'string') throw new TypeError('process control frame kind must be a string');
  const fields = (names: readonly string[]): Record<string, unknown> =>
    rpcRecord(value, ['kind', ...names], 'process control frame');
  switch (kind) {
    case 'ipc:message': {
      const record = fields(['payload']);
      return { kind, payload: record.payload };
    }
    case 'ipc:tty-resize': {
      const record = fields(['cols', 'rows']);
      return {
        kind,
        cols: ttyDimension(record.cols as number, 'cols'),
        rows: ttyDimension(record.rows as number, 'rows'),
      };
    }
    case 'ipc:disconnect':
    case 'control:peer-closing':
      fields([]);
      return { kind };
    case 'control:signal':
    case 'control:self-signal': {
      const record = fields(['signal']);
      return { kind, signal: controlSignal(record.signal) };
    }
    case 'control:self-exit': {
      const record = fields(['code']);
      return { kind, code: controlExitCode(record.code) };
    }
    case 'control:kill-tree': {
      const record = fields(['pid', 'signal', 'cascade']);
      if (typeof record.cascade !== 'boolean') {
        throw new TypeError('process control cascade must be a boolean');
      }
      return {
        kind,
        pid: positivePid(record.pid, 'process control target'),
        signal: controlSignal(record.signal),
        cascade: record.cascade,
      };
    }
    case 'control:stdio-order':
      return decodeWorkerStdioOrderFrame(value);
    case 'control:listening': {
      const hasScope = Object.prototype.hasOwnProperty.call(value, 'previewScope');
      const record = fields(hasScope ? ['ports', 'previewScope'] : ['ports']);
      const previewScope =
        record.previewScope === undefined ? undefined : controlSignal(record.previewScope);
      return {
        kind,
        ports: listeningPorts(record.ports),
        ...(previewScope === undefined ? {} : { previewScope }),
      };
    }
    default:
      throw new TypeError(`unknown process control frame kind ${kind}`);
  }
}
