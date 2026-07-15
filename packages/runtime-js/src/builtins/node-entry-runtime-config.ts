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

function assertExactFields(
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

function booleanField(record: Record<string, unknown>, key: string, owner: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') throw new TypeError(`${owner}.${key} must be a boolean`);
  return value;
}

function positiveInteger(value: unknown, owner: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new RangeError(`${owner} must be a positive safe integer`);
  }
  return value as number;
}

function snapshotTerminal(value: unknown): NodeEntryTerminalBootstrap {
  const record = objectRecord(value, 'node-entry bootstrap terminal');
  assertExactFields(
    record,
    ['stdinIsTTY', 'stdoutIsTTY', 'stderrIsTTY', 'cols', 'rows'],
    'node-entry bootstrap terminal',
  );
  return Object.freeze({
    stdinIsTTY: booleanField(record, 'stdinIsTTY', 'node-entry bootstrap terminal'),
    stdoutIsTTY: booleanField(record, 'stdoutIsTTY', 'node-entry bootstrap terminal'),
    stderrIsTTY: booleanField(record, 'stderrIsTTY', 'node-entry bootstrap terminal'),
    cols: positiveInteger(record.cols, 'node-entry bootstrap terminal cols'),
    rows: positiveInteger(record.rows, 'node-entry bootstrap terminal rows'),
  });
}

function snapshotLaunch(value: unknown): NodeEntryLaunch {
  const record = objectRecord(value, 'node-entry bootstrap launch');
  if (record.kind === 'program') {
    assertExactFields(
      record,
      ['kind', 'bin', 'remoteFs', 'nodeServe', 'previewScope', 'terminal'],
      'node-entry bootstrap program launch',
    );
    const previewScope = record.previewScope;
    if (previewScope !== undefined && (typeof previewScope !== 'string' || previewScope === '')) {
      throw new TypeError('node-entry bootstrap launch.previewScope must be a non-empty string');
    }
    const terminal = record.terminal;
    return Object.freeze({
      kind: 'program',
      bin: booleanField(record, 'bin', 'node-entry bootstrap launch'),
      remoteFs: booleanField(record, 'remoteFs', 'node-entry bootstrap launch'),
      nodeServe: booleanField(record, 'nodeServe', 'node-entry bootstrap launch'),
      ...(previewScope === undefined ? {} : { previewScope }),
      ...(terminal === undefined ? {} : { terminal: snapshotTerminal(terminal) }),
    });
  }
  if (record.kind === 'worker-thread') {
    assertExactFields(
      record,
      ['kind', 'remoteFs', 'threadId', 'workerDataJson'],
      'node-entry bootstrap worker-thread launch',
    );
    const workerDataJson = record.workerDataJson;
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
      remoteFs: booleanField(record, 'remoteFs', 'node-entry bootstrap launch'),
      threadId: positiveInteger(record.threadId, 'node-entry bootstrap launch.threadId'),
      ...(workerDataJson === undefined ? {} : { workerDataJson }),
    });
  }
  throw new TypeError('node-entry bootstrap launch.kind must be program or worker-thread');
}

function snapshotPayload(value: unknown): NodeEntryBootstrapPayload {
  const record = objectRecord(value, 'node-entry bootstrap payload');
  assertExactFields(record, ['hostRuntime', 'launch'], 'node-entry bootstrap payload');
  return Object.freeze({
    hostRuntime: snapshotHostRuntime(record.hostRuntime),
    launch: snapshotLaunch(record.launch),
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
