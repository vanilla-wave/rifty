// PTY frame family of the owner protocol: page→owner control frames and
// owner→page terminal frames (wire types: glue/pty-protocol.ts). Split out of
// owner-protocol.ts (file-size ratchet; the family owns its own frame
// vocabulary). Preview frames stay with the message owner.

import type {
  OwnerToPageFrame,
  PageToOwnerFrame,
  PtyPreview,
  PtyPreviewReq,
} from '../glue/pty-protocol.ts';
import {
  boolean,
  bytes,
  dimension,
  exact,
  inspectStringMap,
  integer,
  invalid,
  nonEmptyString,
  nonNegativeInteger,
  optionalKeys,
  own,
  port,
  record,
  string,
} from './owner-protocol-inspect.ts';

export type PageProjectPtyFrame = Exclude<PageToOwnerFrame, PtyPreviewReq>;
export type OwnerProjectPtyFrame = Exclude<OwnerToPageFrame, PtyPreview>;

export function inspectPagePtyFrame(value: unknown): PageProjectPtyFrame {
  const frame = record(value, 'page PTY frame');
  switch (frame.type) {
    case 'pty:open': {
      const keys = optionalKeys(frame, ['type', 'sid'], ['cwd', 'env']);
      exact(frame, keys, 'pty:open frame');
      nonEmptyString(frame.sid, 'pty:open sid');
      if (own(frame, 'cwd')) nonEmptyString(frame.cwd, 'pty:open cwd');
      if (own(frame, 'env')) inspectStringMap(frame.env, 'pty:open env');
      break;
    }
    case 'pty:exec':
      exact(frame, ['type', 'sid', 'rid', 'line', 'cols', 'rows', 'isTTY'], 'pty:exec frame');
      nonEmptyString(frame.sid, 'pty:exec sid');
      nonEmptyString(frame.rid, 'pty:exec rid');
      string(frame.line, 'pty:exec line');
      dimension(frame.cols, 'pty:exec cols');
      dimension(frame.rows, 'pty:exec rows');
      boolean(frame.isTTY, 'pty:exec isTTY');
      break;
    case 'pty:stdin':
      exact(frame, ['type', 'sid', 'rid', 'opId', 'data'], 'pty:stdin frame');
      runOperation(frame, 'pty:stdin');
      bytes(frame.data, 'pty:stdin data');
      break;
    case 'pty:stdin-eof':
      exact(frame, ['type', 'sid', 'rid', 'opId'], 'pty:stdin-eof frame');
      runOperation(frame, 'pty:stdin-eof');
      break;
    case 'pty:signal':
      exact(frame, ['type', 'sid', 'rid', 'signal'], 'pty:signal frame');
      nonEmptyString(frame.sid, 'pty:signal sid');
      nonEmptyString(frame.rid, 'pty:signal rid');
      if (frame.signal !== 'SIGINT') throw invalid('pty:signal signal');
      break;
    case 'pty:resize':
      exact(frame, ['type', 'sid', 'rid', 'opId', 'cols', 'rows'], 'pty:resize frame');
      runOperation(frame, 'pty:resize');
      dimension(frame.cols, 'pty:resize cols');
      dimension(frame.rows, 'pty:resize rows');
      break;
    case 'pty:session-resize':
      exact(frame, ['type', 'sid', 'opId', 'cols', 'rows'], 'pty:session-resize frame');
      sessionOperation(frame, 'pty:session-resize');
      dimension(frame.cols, 'pty:session-resize cols');
      dimension(frame.rows, 'pty:session-resize rows');
      break;
    case 'pty:close':
      exact(frame, ['type', 'sid', 'opId'], 'pty:close frame');
      sessionOperation(frame, 'pty:close');
      break;
    case 'pty:dev-server-req':
      exact(frame, ['type'], 'pty:dev-server-req frame');
      break;
    case 'pty:dev-config':
      exact(frame, ['type', 'id', 'templateId', 'slug', 'setup'], 'pty:dev-config frame');
      nonEmptyString(frame.id, 'pty:dev-config id');
      nonEmptyString(frame.templateId, 'pty:dev-config templateId');
      nonEmptyString(frame.slug, 'pty:dev-config slug');
      if (frame.setup !== 'instant' && frame.setup !== 'from-scratch') {
        throw invalid('pty:dev-config setup');
      }
      break;
    default:
      throw invalid('page PTY frame');
  }
  return Object.freeze(frame) as unknown as PageProjectPtyFrame;
}

export function inspectOwnerPtyFrame(value: unknown): OwnerProjectPtyFrame {
  const frame = record(value, 'owner PTY frame');
  switch (frame.type) {
    case 'pty:ready': {
      exact(frame, optionalKeys(frame, ['type', 'sid'], ['error']), 'pty:ready frame');
      nonEmptyString(frame.sid, 'pty:ready sid');
      if (own(frame, 'error')) string(frame.error, 'pty:ready error');
      break;
    }
    case 'pty:run-ready':
      exact(frame, ['type', 'sid', 'rid'], 'pty:run-ready frame');
      nonEmptyString(frame.sid, 'pty:run-ready sid');
      nonEmptyString(frame.rid, 'pty:run-ready rid');
      break;
    case 'pty:chunk':
      exact(frame, ['type', 'sid', 'rid', 'stream', 'seq', 'data'], 'pty:chunk frame');
      nonEmptyString(frame.sid, 'pty:chunk sid');
      nonEmptyString(frame.rid, 'pty:chunk rid');
      if (frame.stream !== 'stdout' && frame.stream !== 'stderr') {
        throw invalid('pty:chunk stream');
      }
      nonNegativeInteger(frame.seq, 'pty:chunk seq');
      bytes(frame.data, 'pty:chunk data');
      break;
    case 'pty:exit': {
      exact(
        frame,
        optionalKeys(frame, ['type', 'sid', 'rid', 'code', 'exit', 'cwd', 'env'], ['error']),
        'pty:exit frame',
      );
      nonEmptyString(frame.sid, 'pty:exit sid');
      nonEmptyString(frame.rid, 'pty:exit rid');
      integer(frame.code, 'pty:exit code');
      inspectProcessExit(frame.exit);
      nonEmptyString(frame.cwd, 'pty:exit cwd');
      inspectStringMap(frame.env, 'pty:exit env');
      if (own(frame, 'error')) string(frame.error, 'pty:exit error');
      break;
    }
    case 'pty:resize-ack':
      inspectAck(frame, ['type', 'sid', 'rid', 'opId'], 'pty:resize-ack');
      nonEmptyString(frame.sid, 'pty:resize-ack sid');
      nonEmptyString(frame.rid, 'pty:resize-ack rid');
      nonEmptyString(frame.opId, 'pty:resize-ack opId');
      break;
    case 'pty:session-resize-ack':
      inspectAck(frame, ['type', 'sid', 'opId'], 'pty:session-resize-ack');
      nonEmptyString(frame.sid, 'pty:session-resize-ack sid');
      nonEmptyString(frame.opId, 'pty:session-resize-ack opId');
      break;
    case 'pty:stdin-ack':
      inspectAck(frame, ['type', 'sid', 'rid', 'opId'], 'pty:stdin-ack');
      nonEmptyString(frame.sid, 'pty:stdin-ack sid');
      nonEmptyString(frame.rid, 'pty:stdin-ack rid');
      nonEmptyString(frame.opId, 'pty:stdin-ack opId');
      break;
    case 'pty:close-ack':
      inspectAck(frame, ['type', 'sid', 'opId'], 'pty:close-ack');
      nonEmptyString(frame.sid, 'pty:close-ack sid');
      nonEmptyString(frame.opId, 'pty:close-ack opId');
      break;
    case 'pty:dev-server':
      inspectDevServer(frame);
      break;
    case 'pty:dev-config-ready':
      exact(frame, optionalKeys(frame, ['type', 'id'], ['error']), 'pty:dev-config-ready frame');
      nonEmptyString(frame.id, 'pty:dev-config-ready id');
      if (own(frame, 'error')) string(frame.error, 'pty:dev-config-ready error');
      break;
    default:
      throw invalid('owner PTY frame');
  }
  return Object.freeze(frame) as unknown as OwnerProjectPtyFrame;
}

function inspectProcessExit(value: unknown): void {
  const exit = record(value, 'physical process exit');
  exact(exit, ['code', 'signal'], 'physical process exit');
  if (exit.code === null && (exit.signal === 'SIGINT' || exit.signal === 'SIGTERM')) return;
  if (exit.signal === null && Number.isSafeInteger(exit.code)) return;
  throw invalid('physical process exit');
}

function inspectDevServer(frame: Record<string, unknown>): void {
  exact(
    frame,
    optionalKeys(frame, ['type', 'status'], ['sid', 'cwd', 'port', 'previewScope', 'url', 'error']),
    'pty:dev-server frame',
  );
  if (frame.status !== 'starting' && frame.status !== 'running' && frame.status !== 'stopped') {
    throw invalid('pty:dev-server status');
  }
  for (const field of ['sid', 'cwd', 'previewScope', 'url'] as const) {
    if (own(frame, field)) nonEmptyString(frame[field], `pty:dev-server ${field}`);
  }
  if (own(frame, 'port')) port(frame.port, 'pty:dev-server port');
  if (own(frame, 'error')) string(frame.error, 'pty:dev-server error');
}

function inspectAck(
  frame: Record<string, unknown>,
  baseKeys: readonly string[],
  label: string,
): void {
  if (frame.ok === true) {
    exact(frame, [...baseKeys, 'ok'], `${label} success frame`);
    return;
  }
  if (frame.ok === false) {
    exact(frame, [...baseKeys, 'ok', 'error'], `${label} failure frame`);
    string(frame.error, `${label} error`);
    return;
  }
  throw invalid(`${label} result`);
}

function runOperation(frame: Record<string, unknown>, label: string): void {
  nonEmptyString(frame.sid, `${label} sid`);
  nonEmptyString(frame.rid, `${label} rid`);
  nonEmptyString(frame.opId, `${label} opId`);
}

function sessionOperation(frame: Record<string, unknown>, label: string): void {
  nonEmptyString(frame.sid, `${label} sid`);
  nonEmptyString(frame.opId, `${label} opId`);
}
