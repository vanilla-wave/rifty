import type { VfsMutationGuard } from '@riftydev/vfs';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { applyGuardedProjectIndexRecovery } from './project-index-recovery.ts';
import { INDEX_PATH, planProjectIndexRecovery } from './project-index.ts';

function recoveryFixture() {
  const fs = new MemoryFsSync();
  fs.mkdirSync('/projects/a', { recursive: true });
  fs.mkdirSync('/projects/b', { recursive: true });
  fs.mkdirSync('/scratch', { recursive: true });
  const plan = planProjectIndexRecovery(fs, '/', { starter: 'node-worker' });
  return { fs, plan };
}

describe('applyGuardedProjectIndexRecovery', () => {
  it('leaves every tree and synthesis untouched when the first guard rejects', async () => {
    const { fs, plan } = recoveryFixture();
    const reject: VfsMutationGuard = async () => {
      throw new Error('durable revoke failed');
    };

    await expect(applyGuardedProjectIndexRecovery(fs, plan, reject)).rejects.toThrow(
      'durable revoke failed',
    );

    expect(fs.existsSync('/projects/a')).toBe(true);
    expect(fs.existsSync('/projects/b')).toBe(true);
    expect(fs.existsSync(INDEX_PATH('/'))).toBe(false);
  });

  it('keeps completed deletions, stops at a later rejection, and never synthesizes early', async () => {
    const { fs, plan } = recoveryFixture();
    const seen: string[] = [];
    const rejectSecond: VfsMutationGuard = async (intents, apply) => {
      const [intent] = intents;
      if (!intent || !('path' in intent)) throw new Error('expected path intent');
      seen.push(intent.path);
      if (seen.length === 2) throw new Error('second revoke failed');
      return apply();
    };

    await expect(applyGuardedProjectIndexRecovery(fs, plan, rejectSecond)).rejects.toThrow(
      'second revoke failed',
    );

    expect(seen).toEqual(['/projects/a', '/projects/b']);
    expect(fs.existsSync('/projects/a')).toBe(false);
    expect(fs.existsSync('/projects/b')).toBe(true);
    expect(fs.existsSync(INDEX_PATH('/'))).toBe(false);
  });

  it('synthesizes only after every guarded deletion succeeds', async () => {
    const { fs, plan } = recoveryFixture();
    const applyAll: VfsMutationGuard = (_intents, apply) => apply();

    const index = await applyGuardedProjectIndexRecovery(fs, plan, applyAll);

    expect(fs.existsSync('/projects/a')).toBe(false);
    expect(fs.existsSync('/projects/b')).toBe(false);
    expect(fs.existsSync(INDEX_PATH('/'))).toBe(true);
    expect(index.scratch?.starter).toBe('node-worker');
  });
});
