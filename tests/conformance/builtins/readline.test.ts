import { describe, expect, it } from 'vitest';
import { EventEmitter } from '../../../packages/runtime-js/src/builtins/events.ts';
import { readline } from '../../../packages/runtime-js/src/builtins/null-net-stubs.ts';

/**
 * Readline split: terminal cursor helpers are real ANSI writers (Prettier uses
 * them for progress-line cleanup), while interactive readline remains a loud
 * browser capability ceiling.
 */
function expectFeatureThrow(fn: () => unknown, feature: string): void {
  try {
    fn();
    throw new Error(`expected ${feature} to throw NotImplementedError`);
  } catch (err) {
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('NotImplementedError');
    expect((err as Error & { feature?: string }).feature).toBe(feature);
    expect((err as Error).message).toContain(feature);
  }
}

function capture(): { stream: { write(chunk: string): boolean }; out: () => string } {
  let out = '';
  return {
    stream: {
      write(chunk: string): boolean {
        out += chunk;
        return true;
      },
    },
    out: () => out,
  };
}

function input(): EventEmitter & {
  setEncoding(encoding: string): void;
  resume(): void;
  pause(): void;
} {
  const stream = new EventEmitter() as EventEmitter & {
    setEncoding(encoding: string): void;
    resume(): void;
    pause(): void;
  };
  stream.setEncoding = () => {};
  stream.resume = () => {};
  stream.pause = () => {};
  return stream;
}

describe('node:readline cursor helpers + interactive ceiling', () => {
  it('imports without throwing and exposes expected methods', () => {
    expect(readline).toBeDefined();
    expect(typeof readline.createInterface).toBe('function');
    expect(typeof readline.cursorTo).toBe('function');
    expect(typeof readline.moveCursor).toBe('function');
    expect(typeof readline.clearLine).toBe('function');
    expect(typeof readline.clearScreenDown).toBe('function');
    expect(typeof readline.emitKeypressEvents).toBe('function');
  });

  it('createInterface emits line and close events from a line-oriented input stream', () => {
    const source = input();
    const rl = readline.createInterface({ input: source }) as unknown as EventEmitter & {
      close(): void;
    };
    const lines: string[] = [];
    let closeCount = 0;
    rl.on('line', (line) => lines.push(line as string));
    rl.on('close', () => {
      closeCount += 1;
    });

    source.emit('data', 'one\ntwo\r\npartial');
    source.emit('data', ' tail\n');
    source.emit('end');
    rl.close();

    expect(lines).toEqual(['one', 'two', 'partial tail']);
    expect(closeCount).toBe(1);
  });

  it('question writes the prompt and resolves with the next input line', () => {
    const source = input();
    const { stream, out } = capture();
    const rl = readline.createInterface({ input: source, output: stream }) as unknown as {
      question(prompt: string, cb: (answer: string) => void): void;
    };
    const answers: string[] = [];

    rl.question('Name? ', (answer) => answers.push(answer));
    source.emit('data', 'Ada\n');

    expect(out()).toBe('Name? ');
    expect(answers).toEqual(['Ada']);
  });

  it('setPrompt/prompt writes the prompt without prefixing the next line', () => {
    const source = input();
    const { stream, out } = capture();
    const rl = readline.createInterface({
      input: source,
      output: stream,
    }) as unknown as EventEmitter & {
      setPrompt(prompt: string): void;
      prompt(): void;
    };
    const lines: string[] = [];
    rl.on('line', (line) => lines.push(line as string));

    rl.setPrompt('rifty> ');
    rl.prompt();
    source.emit('data', 'hello\n');

    expect(out()).toBe('rifty> ');
    expect(lines).toEqual(['hello']);
  });

  it('cursorTo writes an ANSI absolute-column sequence', () => {
    const { stream, out } = capture();
    expect(readline.cursorTo(stream, 0)).toBe(true);
    expect(out()).toBe('\x1b[1G');
  });

  it('moveCursor writes relative ANSI movement sequences', () => {
    const { stream, out } = capture();
    expect(readline.moveCursor(stream, -2, 1)).toBe(true);
    expect(out()).toBe('\x1b[2D\x1b[1B');
  });

  it('clearLine writes an ANSI line-clear sequence', () => {
    const { stream, out } = capture();
    expect(readline.clearLine(stream, 0)).toBe(true);
    expect(out()).toBe('\x1b[2K');
  });

  it('clearScreenDown writes an ANSI clear-to-screen-end sequence', () => {
    const { stream, out } = capture();
    expect(readline.clearScreenDown(stream)).toBe(true);
    expect(out()).toBe('\x1b[0J');
  });

  it('emitKeypressEvents throws NotImplementedError', () => {
    expectFeatureThrow(() => readline.emitKeypressEvents(), 'readline.emitKeypressEvents');
  });
});
