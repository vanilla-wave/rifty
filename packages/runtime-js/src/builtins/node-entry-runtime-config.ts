import { type WorkerEntryDescriptor, readKernelEntryBootstrap } from '@riftydev/kernel';

export const NODE_ENTRY_BOOTSTRAP_PROTOCOL = 'rifty.node-entry/v1' as const;

export interface NodeEntryTerminalBootstrap {
  readonly stdinIsTTY: boolean;
  readonly stdoutIsTTY: boolean;
  readonly stderrIsTTY: boolean;
  readonly cols: number;
  readonly rows: number;
}

export interface NodeEntryProgramLaunch {
  readonly kind: 'program';
  readonly bin: boolean;
  readonly remoteFs: boolean;
  readonly nodeServe: boolean;
  readonly previewScope?: string;
  readonly terminal?: NodeEntryTerminalBootstrap;
}

export interface NodeEntryWorkerThreadLaunch {
  readonly kind: 'worker-thread';
  readonly remoteFs: boolean;
  readonly threadId: number;
  readonly workerDataJson?: string;
}

export type NodeEntryLaunch = NodeEntryProgramLaunch | NodeEntryWorkerThreadLaunch;

export interface NodeEntryBootstrapPayload {
  readonly hostRuntime: Readonly<Record<string, string>>;
  readonly launch: NodeEntryLaunch;
}

type NodeEntryWorkerEntry = Extract<WorkerEntryDescriptor, { readonly kind: 'url' }>;

interface NodeEntryWorkerConfig {
  readonly url: string;
  readonly hostRuntime: Readonly<Record<string, string>> | null;
}

let nodeEntryWorkerConfig: NodeEntryWorkerConfig | null = null;

function snapshotUrl(url: string | URL): string {
  const value = String(url);
  if (value.length === 0) throw new TypeError('node-entry worker URL must be non-empty');
  return value;
}

function objectRecord(value: unknown, owner: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${owner} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertAllowedOwnFields(
  record: Record<string, unknown>,
  allowed: readonly string[],
  owner: string,
): void {
  const allowedFields = new Set<string>(allowed);
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key === 'string' && allowedFields.has(key)) continue;
    const label = typeof key === 'string' ? key : String(key);
    throw new TypeError(`${owner} has unexpected field ${label}`);
  }
}

function requiredOwnField(record: Record<string, unknown>, field: string, owner: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(record, field)) {
    throw new TypeError(`${owner} has missing field ${field}`);
  }
  return record[field];
}

function optionalOwnField(record: Record<string, unknown>, field: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, field) ? record[field] : undefined;
}

function snapshotHostRuntime(value: unknown): Readonly<Record<string, string>> {
  const record = objectRecord(value, 'node-entry host runtime');
  const entries = Object.entries(record);
  if (entries.length === 0) {
    throw new TypeError('node-entry host runtime must contain reserved RIFTY_* values');
  }
  const snapshot: Record<string, string> = {};
  for (const [key, entry] of entries) {
    if (!key.startsWith('RIFTY_') || typeof entry !== 'string' || entry.length === 0) {
      throw new TypeError(
        'node-entry host runtime must map reserved RIFTY_* keys to non-empty strings',
      );
    }
    snapshot[key] = entry;
  }
  return Object.freeze(snapshot);
}

function booleanValue(value: unknown, key: string, owner: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${owner}.${key} must be a boolean`);
  return value;
}

function booleanOwnField(record: Record<string, unknown>, key: string, owner: string): boolean {
  return booleanValue(requiredOwnField(record, key, owner), key, owner);
}

function positiveInteger(value: unknown, owner: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new RangeError(`${owner} must be a positive safe integer`);
  }
  return value as number;
}

const TERMINAL_FIELDS = ['stdinIsTTY', 'stdoutIsTTY', 'stderrIsTTY', 'cols', 'rows'] as const;

/** Package-internal exact-own snapshot shared by entry and late process bootstraps. */
export function snapshotNodeEntryTerminalBootstrap(
  value: unknown,
  owner = 'node-entry bootstrap terminal',
): NodeEntryTerminalBootstrap {
  const record = objectRecord(value, owner);
  assertAllowedOwnFields(record, TERMINAL_FIELDS, owner);
  const stdinIsTTY = requiredOwnField(record, 'stdinIsTTY', owner);
  const stdoutIsTTY = requiredOwnField(record, 'stdoutIsTTY', owner);
  const stderrIsTTY = requiredOwnField(record, 'stderrIsTTY', owner);
  const cols = requiredOwnField(record, 'cols', owner);
  const rows = requiredOwnField(record, 'rows', owner);
  return Object.freeze({
    stdinIsTTY: booleanValue(stdinIsTTY, 'stdinIsTTY', owner),
    stdoutIsTTY: booleanValue(stdoutIsTTY, 'stdoutIsTTY', owner),
    stderrIsTTY: booleanValue(stderrIsTTY, 'stderrIsTTY', owner),
    cols: positiveInteger(cols, `${owner} cols`),
    rows: positiveInteger(rows, `${owner} rows`),
  });
}

function snapshotLaunch(value: unknown): NodeEntryLaunch {
  const record = objectRecord(value, 'node-entry bootstrap launch');
  const kind = requiredOwnField(record, 'kind', 'node-entry bootstrap launch');
  if (kind === 'program') {
    assertAllowedOwnFields(
      record,
      ['kind', 'bin', 'remoteFs', 'nodeServe', 'previewScope', 'terminal'],
      'node-entry bootstrap program launch',
    );
    const bin = booleanOwnField(record, 'bin', 'node-entry bootstrap launch');
    const remoteFs = booleanOwnField(record, 'remoteFs', 'node-entry bootstrap launch');
    const nodeServe = booleanOwnField(record, 'nodeServe', 'node-entry bootstrap launch');
    const previewScope = optionalOwnField(record, 'previewScope');
    if (previewScope !== undefined && (typeof previewScope !== 'string' || previewScope === '')) {
      throw new TypeError('node-entry bootstrap launch.previewScope must be a non-empty string');
    }
    const terminal = optionalOwnField(record, 'terminal');
    return Object.freeze({
      kind: 'program',
      bin,
      remoteFs,
      nodeServe,
      ...(previewScope === undefined ? {} : { previewScope }),
      ...(terminal === undefined ? {} : { terminal: snapshotNodeEntryTerminalBootstrap(terminal) }),
    });
  }
  if (kind === 'worker-thread') {
    assertAllowedOwnFields(
      record,
      ['kind', 'remoteFs', 'threadId', 'workerDataJson'],
      'node-entry bootstrap worker-thread launch',
    );
    const remoteFs = booleanOwnField(record, 'remoteFs', 'node-entry bootstrap launch');
    const threadId = positiveInteger(
      requiredOwnField(record, 'threadId', 'node-entry bootstrap launch'),
      'node-entry bootstrap launch.threadId',
    );
    const workerDataJson = optionalOwnField(record, 'workerDataJson');
    if (workerDataJson !== undefined) {
      if (typeof workerDataJson !== 'string') {
        throw new TypeError('node-entry bootstrap launch.workerDataJson must be a string');
      }
      try {
        JSON.parse(workerDataJson);
      } catch {
        throw new TypeError('node-entry bootstrap launch.workerDataJson must contain valid JSON');
      }
    }
    return Object.freeze({
      kind: 'worker-thread',
      remoteFs,
      threadId,
      ...(workerDataJson === undefined ? {} : { workerDataJson }),
    });
  }
  throw new TypeError('node-entry bootstrap launch.kind must be program or worker-thread');
}

function snapshotPayload(value: unknown): NodeEntryBootstrapPayload {
  const record = objectRecord(value, 'node-entry bootstrap payload');
  assertAllowedOwnFields(record, ['hostRuntime', 'launch'], 'node-entry bootstrap payload');
  return Object.freeze({
    hostRuntime: snapshotHostRuntime(
      requiredOwnField(record, 'hostRuntime', 'node-entry bootstrap payload'),
    ),
    launch: snapshotLaunch(requiredOwnField(record, 'launch', 'node-entry bootstrap payload')),
  });
}

/** Build a complete URL entry without consulting process-global host configuration. */
export function buildNodeEntryWorkerEntry(
  url: string | URL,
  hostRuntime: Readonly<Record<string, string>>,
  launch: NodeEntryLaunch,
): NodeEntryWorkerEntry {
  const payload = snapshotPayload({ hostRuntime, launch });
  return Object.freeze({
    kind: 'url',
    url: snapshotUrl(url),
    bootstrap: Object.freeze({
      protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
      payload,
    }),
  });
}

/** Build from the atomically configured URL + host snapshot and a fresh launch. */
export function buildConfiguredNodeEntryWorkerEntry(launch: NodeEntryLaunch): NodeEntryWorkerEntry {
  const config = nodeEntryWorkerConfig;
  if (config?.hostRuntime == null) {
    throw new Error('node-entry worker bootstrap config is not configured');
  }
  return buildNodeEntryWorkerEntry(config.url, config.hostRuntime, launch);
}

/** Decode this realm's node-entry envelope; missing/wrong protocol is loud. */
export function readNodeEntryBootstrap(): NodeEntryBootstrapPayload {
  const envelope = readKernelEntryBootstrap();
  if (envelope === null) throw new Error('missing node-entry bootstrap envelope');
  if (envelope.protocol !== NODE_ENTRY_BOOTSTRAP_PROTOCOL) {
    throw new Error(
      `node-entry bootstrap protocol mismatch: expected ${NODE_ENTRY_BOOTSTRAP_PROTOCOL}, received ${envelope.protocol}`,
    );
  }
  return snapshotPayload(envelope.payload);
}

/** Read only when this URL entry belongs to runtime-js; other entries retain legacy metadata. */
export function readNodeEntryBootstrapIfPresent(): NodeEntryBootstrapPayload | null {
  const envelope = readKernelEntryBootstrap();
  if (envelope === null || envelope.protocol !== NODE_ENTRY_BOOTSTRAP_PROTOCOL) return null;
  return snapshotPayload(envelope.payload);
}

/** Atomically install the node-entry URL and its out-of-band host snapshot. */
export function configureNodeEntryWorkerRuntime(
  url: string | URL,
  hostRuntime: Readonly<Record<string, string>>,
): void {
  const nextUrl = snapshotUrl(url);
  const nextHostRuntime = snapshotHostRuntime(hostRuntime);
  nodeEntryWorkerConfig = { url: nextUrl, hostRuntime: nextHostRuntime };
}

/** URL-only compatibility seam: a previous host snapshot is invalid now. */
export function setNodeEntryWorkerUrlOnly(url: string | URL): void {
  nodeEntryWorkerConfig = { url: snapshotUrl(url), hostRuntime: null };
}

export function getConfiguredNodeEntryWorkerUrl(): string | null {
  return nodeEntryWorkerConfig?.url ?? null;
}

export function resetNodeEntryWorkerRuntime(): void {
  nodeEntryWorkerConfig = null;
}
