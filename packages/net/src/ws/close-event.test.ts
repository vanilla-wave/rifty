import { describe, expect, it } from 'vitest';
import { CloseEventCtor } from './close-event.ts';

describe('CloseEventCtor', () => {
  // Contract is identical whether this resolved to the native global (browsers,
  // Node ≥23 — incl. our Node ≥24 `engines` floor) or the defensive Event-subclass
  // fallback — both must produce a dispatchable `close` Event carrying code + reason.
  it('builds a dispatchable close Event carrying code and reason', () => {
    const e = new CloseEventCtor('close', { code: 1001, reason: 'bye-from-server' });
    expect(e).toBeInstanceOf(Event);
    expect(e.type).toBe('close');
    const ce = e as Event & { code: number; reason: string };
    expect(ce.code).toBe(1001);
    expect(ce.reason).toBe('bye-from-server');

    const target = new EventTarget();
    let received: number | undefined;
    target.addEventListener(
      'close',
      (x) => {
        received = (x as Event & { code?: number }).code;
      },
      { once: true },
    );
    target.dispatchEvent(e);
    expect(received).toBe(1001);
  });

  it('defaults code/reason when omitted', () => {
    const e = new CloseEventCtor('close') as Event & { code: number; reason: string };
    expect(e.code).toBe(0);
    expect(e.reason).toBe('');
  });
});
