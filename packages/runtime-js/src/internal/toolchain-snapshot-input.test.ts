import { expect, it } from 'vitest';
import type { ToolchainApplySnapshotRequest } from '../protocol.ts';
import { validateOpenRequest, validateSnapshotRequest } from './toolchain-input.ts';

const source = {
  assetUrl: '/snapshot.tar.gz',
  snapshotId: `sha256:${'a'.repeat(64)}`,
  templateId: 'project',
};

it('captures optional force and detaches the public snapshot descriptor', () => {
  const input = { cwd: '/project', snapshot: { ...source }, force: true };
  const captured = validateSnapshotRequest(input);
  input.snapshot.assetUrl = '/changed';
  input.force = false;
  expect(captured).toEqual({ cwd: '/project', snapshot: source, force: true });
  expect(validateSnapshotRequest({ cwd: '/project', snapshot: source }).force).toBe(false);
  expect(validateOpenRequest({ cwd: '/project' })).toEqual({ cwd: '/project' });
});

it.each([
  null,
  {},
  { cwd: 'relative', snapshot: source },
  { cwd: '/project', snapshot: source, force: 'yes' },
  { cwd: '/project', snapshot: source, extra: true },
  { cwd: '/project', snapshot: { ...source, snapshotId: 'bad' } },
  { cwd: '/project', snapshot: { ...source, assetUrl: '' } },
  { cwd: '/project', snapshot: { ...source, templateId: '' } },
  { cwd: '/project', snapshot: { ...source, extra: true } },
  {
    cwd: '/project',
    snapshot: Object.defineProperty({ ...source }, 'assetUrl', { get: () => '/effect' }),
  },
])('rejects malformed snapshot request %j', (input) => {
  expect(() => validateSnapshotRequest(input as ToolchainApplySnapshotRequest)).toThrow(TypeError);
});
