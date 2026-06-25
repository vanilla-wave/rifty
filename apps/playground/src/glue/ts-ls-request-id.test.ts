import { describe, expect, it } from 'vitest';
import { nextTsLspRequestId } from './ts-ls-request-id.ts';

describe('nextTsLspRequestId', () => {
  it('allocates monotonically across client instances sharing one relay', () => {
    const firstClientRequest = nextTsLspRequestId();
    const secondClientRequest = nextTsLspRequestId();

    expect(secondClientRequest).toBeGreaterThan(firstClientRequest);
  });
});
