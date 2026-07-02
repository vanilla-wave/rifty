import { describe, expect, it } from 'vitest';
import { PROMPT_PROFILE_ID, buildSystemPrompt } from './prompt-profile.ts';

describe('prompt profile', () => {
  it('is the versioned pi-baseline+rifty-adapter profile', () => {
    expect(PROMPT_PROFILE_ID).toBe('pi-baseline+rifty-adapter-v1');
  });

  it('keeps the Pi baseline framing + always-on guidelines and appends the rifty adapter block', () => {
    const prompt = buildSystemPrompt({
      cwd: '/scratch',
      tools: [{ name: 'shell', snippet: 'run a command' }],
      now: new Date('2026-07-02T12:00:00Z'),
    });
    // Pi baseline (vendored, MIT — earendil-works/pi).
    expect(prompt).toContain('You are an expert coding assistant operating inside pi');
    expect(prompt).toContain('- shell: run a command');
    expect(prompt).toContain('- Be concise in your responses');
    // rifty adapter block: browser-environment facts + preview habit.
    expect(prompt).toContain('rifty — Node.js in the browser');
    expect(prompt).toContain('no sudo');
    expect(prompt).toContain('dev server may already be running');
    // Date + cwd land last, like upstream.
    expect(prompt).toMatch(/Current date: 2026-07-02\nCurrent working directory: \/scratch$/);
  });
});
