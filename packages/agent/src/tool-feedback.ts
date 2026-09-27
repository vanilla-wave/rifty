import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import { TOOL_RESULT_CAP_BYTES, capToolText } from './text.ts';

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text).length;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    record(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}

function existingEnvelope(text: string, details: unknown) {
  const newline = text.indexOf('\n');
  try {
    const heading: unknown = JSON.parse(newline < 0 ? text : text.slice(0, newline));
    if (!record(heading) || !record(details)) return undefined;
    const metadata = Object.fromEntries(
      Object.entries(heading).filter(([key]) => key !== 'callsLeft' && key !== 'msLeft'),
    );
    const keys = Object.keys(metadata);
    const preview = keys.length === 1 && typeof metadata.statusCode === 'number';
    const shell =
      typeof metadata.status === 'string' &&
      ['exited', 'cancelled', 'failed'].includes(metadata.status) &&
      (metadata.exitCode === null || typeof metadata.exitCode === 'number') &&
      (metadata.worker === undefined ||
        (typeof metadata.worker === 'string' &&
          ['retained', 'replaced', 'terminated'].includes(metadata.worker))) &&
      keys.every((key) => ['status', 'exitCode', 'worker', 'effects', 'error'].includes(key));
    if (
      (!preview && !shell) ||
      keys.some((key) => canonical(metadata[key]) !== canonical(details[key]))
    )
      return undefined;
    return { metadata, body: newline < 0 ? '' : text.slice(newline + 1) };
  } catch {
    return undefined;
  }
}

/** One final text boundary: intact JSON, stable body capacity, actual remaining counters. */
export function toolReceipt(
  result: AgentToolResult<unknown>,
  name: string,
  owned: boolean,
  isError: boolean,
  remaining: { callsLeft: number; msLeft: number },
  limits: { maxToolCalls: number; runTimeoutMs: number },
): string {
  const text = result.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n');
  if (isError && text === 'Operation aborted')
    result.details = {
      ...(record(result.details) ? result.details : {}),
      status: 'cancelled',
      applied: 'no',
    };
  // File bytes may resemble an envelope; only actual envelope producers opt in.
  const existing =
    !owned || name === 'shell' || name === 'preview_fetch'
      ? existingEnvelope(text, result.details)
      : undefined;
  if (!owned && !isError && !existing) {
    const body = capToolText(text);
    result.content = [{ type: 'text', text: body }];
    return body;
  }
  let metadata: Record<string, unknown> =
    existing?.metadata ?? (record(result.details) ? { ...result.details } : {});
  if (isError && metadata.status === undefined) metadata.status = 'failed';
  metadata = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => key !== 'callsLeft' && key !== 'msLeft'),
  );
  const maximum = { callsLeft: limits.maxToolCalls, msLeft: limits.runTimeoutMs };
  const header = (meta: Record<string, unknown>, budget = maximum) =>
    JSON.stringify({ ...meta, ...budget });
  if (bytes(header(metadata)) > 4096) {
    const raw = JSON.stringify(metadata);
    const important: Record<string, unknown> = {};
    for (const [key, values] of Object.entries({
      status: ['exited', 'cancelled', 'failed'],
      worker: ['retained', 'replaced', 'terminated'],
      applied: ['no', 'unknown'],
    }))
      if (typeof metadata[key] === 'string' && values.includes(metadata[key]))
        important[key] = metadata[key];
    for (const key of ['exitCode', 'statusCode'])
      if (typeof metadata[key] === 'number' && Number.isFinite(metadata[key]))
        important[key] = metadata[key];
    if (metadata.exitCode === null) important.exitCode = null;
    const shell = { ...important, metadataTruncated: true, metadata: '' };
    // JSON text has no raw controls; quoting its capped form expands at most 2x.
    metadata = {
      ...shell,
      metadata: capToolText(raw, Math.floor((4096 - bytes(header(shell))) / 2)),
    };
  }
  const body = capToolText(
    existing?.body ?? text,
    TOOL_RESULT_CAP_BYTES - bytes(header(metadata)) - 1,
  );
  result.content = [{ type: 'text', text: `${header(metadata, remaining)}\n${body}` }];
  return `${canonical(metadata)}\n${body}`;
}
