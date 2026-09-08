import { describe, expect, it } from 'vitest';
import * as ioPublic from './index.ts';
import * as protocol from './preview-protocol.ts';
import { parsePreviewPath } from './preview-protocol.ts';

type ParsePreviewPath = (
  path: string,
  prefix?: string,
) => { readonly port: number; readonly rest: string } | null;

const parse = parsePreviewPath as ParsePreviewPath;
const previewDocumentPath = (
  protocol as {
    previewDocumentPath?: (prefix: string, port: number) => string;
  }
).previewDocumentPath;

describe('preview prefix addressing (I5)', () => {
  it('keeps omitted prefix as /preview/<port>/', () => {
    expect(parsePreviewPath('/preview/5173/')).toEqual({ port: 5173, rest: '/' });
    expect(parsePreviewPath('/preview/5173/src/main.ts')).toEqual({
      port: 5173,
      rest: '/src/main.ts',
    });
    expect(parse('/preview/5173/', '/preview')).toEqual({ port: 5173, rest: '/' });
  });

  it('parses and builds /sandbox/preview/<port>/ when that prefix is selected', () => {
    expect(
      (
        ioPublic as {
          previewDocumentPath?: (prefix: string, port: number) => string;
        }
      ).previewDocumentPath?.('/sandbox/preview', 5173),
    ).toBe('/sandbox/preview/5173/');
    expect(previewDocumentPath?.('/sandbox/preview', 5173)).toBe('/sandbox/preview/5173/');
    expect(parse('/sandbox/preview/5173/', '/sandbox/preview')).toEqual({
      port: 5173,
      rest: '/',
    });
    expect(parse('/sandbox/preview/5173/src/main.ts', '/sandbox/preview')).toEqual({
      port: 5173,
      rest: '/src/main.ts',
    });
    expect(parse('/preview/5173/', '/sandbox/preview')).toBeNull();
    expect(parse('/api/preview/5173/', '/sandbox/preview')).toBeNull();
  });
});
