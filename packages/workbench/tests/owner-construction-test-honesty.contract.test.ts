import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const constructionFaultTest = new URL(
  '../src/workers/workbench-owner-bootstrap-construction.fault.test.ts',
  import.meta.url,
);

describe('Workbench owner construction fault proof', () => {
  it('does not replace rifty packages or Workbench constructors with module mocks', async () => {
    const source = await readFile(constructionFaultTest, 'utf8');
    const mockedModules = [...source.matchAll(/vi\.mock\((['"])([^'"]+)\1/gu)].map(
      (match) => match[2],
    );

    expect(mockedModules).toEqual([]);
  });
});
