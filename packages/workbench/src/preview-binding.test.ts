import { expect, it } from 'vitest';
import { createPreviewBinding } from './preview-binding.ts';

it('derives preview URL from a runtime session', () => {
  const binding = createPreviewBinding({ session: { port: 4242 } });

  expect(binding.url).toBe('/preview/4242/');
  binding.dispose();
  binding.dispose();
});
