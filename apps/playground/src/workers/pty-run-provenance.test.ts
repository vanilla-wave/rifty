import { describe, expect, it } from 'vitest';
import { createPtyRunProvenanceLedger } from './pty-run-provenance.ts';

describe('pty run provenance ledger', () => {
  it('defaults unknown/settled sessions to protect and allows a sole boot run', () => {
    const ledger = createPtyRunProvenanceLedger();
    expect(ledger.intentForSession(undefined)).toBe('protect');
    expect(ledger.intentForSession('terminal')).toBe('protect');

    const boot = { sid: 'terminal', rid: 'boot-1', origin: 'boot' } as const;
    ledger.start(boot);
    expect(ledger.intentForSession('terminal')).toBe('baseline');
    ledger.settle(boot);
    expect(ledger.intentForSession('terminal')).toBe('protect');
  });

  it('keeps overlapping rid provenance correlated and fails safe on mixed origins', () => {
    const ledger = createPtyRunProvenanceLedger();
    const boot = { sid: 'terminal', rid: 'boot-1', origin: 'boot' } as const;
    const user = { sid: 'terminal', rid: 'user-1', origin: 'user' } as const;

    ledger.start(boot);
    ledger.start(user);
    expect(ledger.intentForSession('terminal')).toBe('protect');

    ledger.settle(boot);
    expect(ledger.intentForSession('terminal')).toBe('protect');
    ledger.start(boot);
    ledger.settle(user);
    expect(ledger.intentForSession('terminal')).toBe('baseline');
  });

  it('does not let a mismatched settle delete another run with the same rid', () => {
    const ledger = createPtyRunProvenanceLedger();
    ledger.start({ sid: 'terminal', rid: 'r1', origin: 'user' });
    ledger.settle({ sid: 'terminal', rid: 'r1', origin: 'boot' });
    expect(ledger.intentForSession('terminal')).toBe('protect');
  });
});
