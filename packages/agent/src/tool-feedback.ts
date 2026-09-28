import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import { TOOL_RESULT_CAP_BYTES, capToolText } from './text.ts';
import { outcomeWithoutDiagnostics } from './tools.ts';
import { hostError } from './workbench-host.ts';

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
      keys.some(
        (key) =>
          canonical(metadata[key]) !==
          canonical(
            key === 'error' && details[key] instanceof Error
              ? hostError(details[key])
              : details[key],
          ),
      )
    )
      return undefined;
    return { metadata, body: newline < 0 ? '' : text.slice(newline + 1) };
  } catch {
    return undefined;
  }
}

function settlement(value: unknown): Record<string, unknown> {
  if (!record(value)) return {};
  const result: Record<string, unknown> = {};
  for (const key of ['applied', 'persistence', 'mutationOutcome', 'code', 'name']) {
    const field = value[key];
    if (
      (typeof field === 'string' && bytes(JSON.stringify(field)) <= 128) ||
      (key === 'mutationOutcome' && field === null)
    )
      result[key] = field;
  }
  if (Array.isArray(value.applied)) {
    const all = value.applied;
    const indices = [...new Set([0, 1, all.length - 1])].filter(
      (index) => index >= 0 && index < all.length,
    );
    const paths = indices
      .map((index) => all[index])
      .filter((path: unknown) => typeof path === 'string' && bytes(JSON.stringify(path)) <= 256);
    result.applied = { count: all.length, paths, omitted: all.length - paths.length };
  }
  return result;
}

function effectsSummary(value: Record<string, unknown>): Record<string, unknown> {
  const summary = settlement(value);
  if (Object.keys(value).some((key) => !Object.hasOwn(summary, key))) summary.detailsOmitted = true;
  return summary;
}

/**
 * One final text boundary: intact JSON, stable body capacity, actual remaining counters.
 * Returns budget-free repeat material; mutation host diagnostics excluded.
 */
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
  // Keep every fitting field. Only an oversized heading needs a bounded projection;
  // leave room for the body's head/tail and truncation notice.
  if (bytes(header(metadata)) > TOOL_RESULT_CAP_BYTES - 257) {
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
    Object.assign(important, settlement(metadata));
    if (record(metadata.effects)) important.effects = effectsSummary(metadata.effects);
    if (record(metadata.error)) {
      const error = settlement(metadata.error);
      if (record(metadata.error.effects)) error.effects = effectsSummary(metadata.error.effects);
      important.error = error;
    }
    const shell = { ...important, metadataTruncated: true, metadata: '' };
    // Keep settlement facts first; reserve quoted context after them.
    const projectionBudget = Math.max(4096, bytes(header(shell)) + 1024);
    // JSON text has no raw controls; quoting its capped form expands at most 2x.
    metadata = {
      ...shell,
      metadata: capToolText(raw, Math.floor((projectionBudget - bytes(header(shell))) / 2)),
    };
  }
  const capacity = TOOL_RESULT_CAP_BYTES - bytes(header(metadata)) - 1;
  const body = capToolText(existing?.body ?? text, capacity);
  result.content = [{ type: 'text', text: `${header(metadata, remaining)}\n${body}` }];
  const outcome = outcomeWithoutDiagnostics(result);
  return `${canonical(metadata)}\n${outcome === undefined ? body : capToolText(outcome, capacity)}`;
}
