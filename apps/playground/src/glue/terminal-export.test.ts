import { describe, expect, it } from 'vitest';
import { makeTerminalHtmlExport } from './terminal-export.ts';

describe('makeTerminalHtmlExport', () => {
  it('wraps serialized terminal HTML in a downloadable document', () => {
    const artifact = makeTerminalHtmlExport(
      '<pre><span>hello</span></pre>',
      new Date('2026-06-09T20:30:00.000Z'),
    );

    expect(artifact.filename).toBe('rifty-terminal-20260609T203000Z.html');
    expect(artifact.mimeType).toBe('text/html;charset=utf-8');
    expect(artifact.content).toContain('<!doctype html>');
    expect(artifact.content).toContain('<meta name="generator" content="rifty">');
    expect(artifact.content).toContain('<pre><span>hello</span></pre>');
  });
});
