import { expect, it } from 'vitest';
import { installProcessWarnings } from './process-warnings.ts';
import { NodeProcess } from './process.ts';

it('warning-file output fails explicitly; an application-owned warning listener still works', () => {
  const process = new NodeProcess();
  process.env.NODE_REDIRECT_WARNINGS = '/warnings.log';
  process.removeAllListeners('warning');
  installProcessWarnings(process);
  const warning = new Error('warning');
  expect(() => process.emit('warning', warning)).toThrowError(
    expect.objectContaining({
      name: 'NotImplementedError',
      feature: 'process.emitWarning.redirect',
    }),
  );
  process.removeAllListeners('warning');
  const seen: unknown[] = [];
  process.on('warning', (value) => seen.push(value));
  process.emit('warning', warning);
  expect(seen).toEqual([warning]);
});
