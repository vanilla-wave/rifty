// Hero terminal boot log — looping typewriter reveal. Cosmetic only.
// Every line names a current public SDK surface; no playground-private exec/preview API.

// One log line: prompt prefix + text + a color class (mapped to a CSS var).
interface BootLine {
  readonly p: string;
  readonly t: string;
  readonly c: 'cmd' | 'dim' | 'ok' | 'lime' | 'req';
}

const BOOT_SCRIPT: readonly BootLine[] = [
  { p: '→ ', t: 'runtime.ready', c: 'dim' },
  { p: 'fs ', t: "writeFile('/hello.js')  ·  ok", c: 'ok' },
  { p: 'eval ', t: 'console.log("hello")', c: 'cmd' },
  { p: 'stdout ', t: 'hello', c: 'lime' },
  { p: 'vfs ', t: 'backend  ·  opfs | memory', c: 'dim' },
];

// per-line reveal delay (ms) and the hold before the loop restarts.
const LINE_DELAY = 620;
const LOOP_HOLD = 2600;

// Track timers per element so a re-run clears the old loop.
const timers = new WeakMap<HTMLElement, number[]>();

function clearTimers(el: HTMLElement): void {
  const handles = timers.get(el);
  if (handles) {
    for (const id of handles) {
      clearTimeout(id);
    }
  }
  timers.set(el, []);
}

function push(el: HTMLElement, id: number): void {
  const handles = timers.get(el);
  if (handles) {
    handles.push(id);
  }
}

function makeLine(line: BootLine): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'hero-term-row';
  const prompt = document.createElement('span');
  prompt.className = 'hero-term-prompt';
  prompt.textContent = line.p;
  const text = document.createElement('span');
  text.className = `hero-term-text hero-term-${line.c}`;
  text.textContent = line.t;
  row.append(prompt, text);
  return row;
}

function makeCursorRow(): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'hero-term-row';
  const prompt = document.createElement('span');
  prompt.className = 'hero-term-prompt';
  prompt.textContent = '$ ';
  const cursor = document.createElement('span');
  cursor.className = 'hero-term-cursor';
  row.append(prompt, cursor);
  return row;
}

/**
 * Start the looping hero boot log inside `el`. Reveals each line on a timer,
 * holds, then clears and replays. Re-running clears the previous loop.
 */
export function startTerminalLog(el: HTMLElement): void {
  clearTimers(el);
  el.style.setProperty('--hero-term-row-count', String(BOOT_SCRIPT.length + 1));

  const cursorRow = makeCursorRow();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.replaceChildren(...BOOT_SCRIPT.map(makeLine), cursorRow);
    return;
  }

  const runOnce = (): void => {
    // All handles from the previous pass have fired; retain only the live pass.
    timers.set(el, []);
    el.replaceChildren(cursorRow);
    BOOT_SCRIPT.forEach((line, i) => {
      const id = window.setTimeout(
        () => {
          cursorRow.before(makeLine(line));
        },
        LINE_DELAY * (i + 1),
      );
      push(el, id);
    });
    const total = LINE_DELAY * (BOOT_SCRIPT.length + 1) + LOOP_HOLD;
    const loopId = window.setTimeout(runOnce, total);
    push(el, loopId);
  };

  runOnce();
}
