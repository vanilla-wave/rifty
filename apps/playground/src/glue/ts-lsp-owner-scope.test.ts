import { describe, expect, it } from 'vitest';
import { stampTsLspOwner, tsLspOwnerMatches } from './ts-lsp-owner-scope.ts';

describe('TS-LSP owner scope', () => {
  it('stamps structured envelopes without mutating the caller object', () => {
    const request = { type: 'rifty:ts-lsp', request: { id: 1 } };
    const stamped = stampTsLspOwner(request, 'owner:a');
    expect(stamped).toEqual({ ...request, ownerBridgeKey: 'owner:a' });
    expect(request).not.toHaveProperty('ownerBridgeKey');
  });

  it('matches only the exact owner key and leaves non-objects untouched', () => {
    expect(tsLspOwnerMatches({ ownerBridgeKey: 'owner:a' }, 'owner:a')).toBe(true);
    expect(tsLspOwnerMatches({ ownerBridgeKey: 'owner:b' }, 'owner:a')).toBe(false);
    expect(stampTsLspOwner('request', 'owner:a')).toBe('request');
    expect(tsLspOwnerMatches(null, 'owner:a')).toBe(false);
  });
});
